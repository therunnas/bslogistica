# BS Soluções Logísticas — Progresso

Andamento do projeto: marcos concluídos, etapa atual e próximas etapas. Regras
permanentes ficam em [CLAUDE.md](CLAUDE.md); o estado factual de Production, dos
testes e das dependências, em [docs/ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md);
o modelo de segurança, em [docs/SEGURANCA.md](docs/SEGURANCA.md). O histórico
detalhado de cada mudança está no Git — este arquivo não o repete.

O checkpoint executável da sessão seguinte fica em
[docs/HANDOFF.md](docs/HANDOFF.md), o processo obrigatório em
[docs/WORKFLOW.md](docs/WORKFLOW.md) e o inventário de ambientes em
[docs/AMBIENTES.md](docs/AMBIENTES.md).

## Objetivo

Painel interno de gestão de mão de obra terceirizada: clientes e contratos,
colaboradores, operações e turnos, apontamento de diárias e horas extras,
faturamento por período e relatórios. Duas trilhas de uso:

- **Admin** — login com MFA opcional, cadastros, operações, turnos, equipe, apontamentos,
  faturamento, relatórios e administração de usuários.
- **Operacional** — recebe convite, entra, vê **somente** as operações que lhe
  foram atribuídas, registra presença e horários, e **não** vê financeiro nem
  telas administrativas.

## Tarefa ativa única

**QA-BS-01 — auditoria, correção e estabilização integral (iniciada em 12/11/2026).** Branch
`fix/qa-bs-01-estabilizacao`, criada sobre o #133 (que inclui o #132) por decisão do
responsável e, depois dos squashes do #132 (`1c6042e`) e do #133 (`f6df1fb`), reconciliada com a
`main` por merge (RECONCILIACAO-134; PR #134 com base `main`). Execução por checkpoints (CP-00 a CP-12): auditar, reproduzir, corrigir, testar,
validar e só então avançar. Estado e próxima ação exata no [HANDOFF](docs/HANDOFF.md).

Tarefa anterior, ainda vigente em HML e Production: **FUNC-READY-02** — domingo e feriado em
dobro com a resolução OFF (051 aplicada nos dois, interruptor ligado). **O piloto ainda não
começou** (ver "Bloqueio do piloto").

### QA-BS-01 — checkpoints

| CP     | Escopo                                                                             | Estado       |
| ------ | ---------------------------------------------------------------------------------- | ------------ |
| CP-00  | Baseline e inventário (Git, PRs, ambientes, docs, 16 telas + 7 de acesso + 5 APIs) | PASS         |
| CP-00B | Baseline executável local (lint, `tsc`, `test:*`, build, E2E, SQL)                 | PASS (Linux) |
| CP-01  | Autenticação e permissões (inclui TOTP real no Supabase local)                     | PASS (local) |
| CP-02  | Clientes e contratos                                                               | PASS (local) |
| CP-03  | Colaboradores e valores                                                            | PASS (local) |
| CP-04  | Operações, turnos e equipes                                                        | PASS (local) |
| CP-05  | Apontamentos e regras financeiras (maior risco)                                    | PASS (local) |
| CP-06  | Serviços avulsos (contêiner é tipo de avulso), adicionais e caminho legado         | PASS (local) |
| CP-06B | Remoção do painel independente de Contêineres; histórico legado em Operações       | PASS (local) |
| CP-07  | Fechamento e faturamento                                                           | PASS (local) |
| CP-08  | Dashboard, relatórios e exportações (+ modelo de negócio consolidado, sessão 13)   | PASS (local) |
| CP-09  | Interface, clareza e consistência                                                  | não iniciado |
| CP-10  | Segurança, integridade e infraestrutura                                            | não iniciado |
| CP-11  | Regressão integrada final                                                          | não iniciado |
| CP-12  | Roteiro de homologação com o responsável (HML só com autorização)                  | não iniciado |

Defeitos registrados no CP-00 (D1–D8 sem correção; I1 corrigido no CP-00B):

| ID  | Defeito                                                                                                   | Prioridade | Evidência                    | CP       |
| --- | --------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------- | -------- |
| D1  | Saída antes da entrada (08:00 → 07:50) salvava sem aviso como 22h50. **Corrigido no CP-05** (telas)      | P1         | E2E #133 `@falha-conhecida`  | CP-05    |
| D2  | "Alterar custo": trocar a data substituía o valor digitado pelo antigo. **Corrigido no CP-03**            | P1         | E2E #133 `@falha-conhecida`  | CP-03    |
| D3  | Duplo clique duplicava cliente e turno. **Corrigido**: cliente no CP-02, turno no CP-04 (envio único)     | P2         | E2E #133 + leitura do código | CP-02/04 |
| D4  | Confirmação da fatura não avisava dias ainda abertos. **Corrigido no CP-07** (aviso, sem bloqueio)        | P2         | E2E #133 `@falha-conhecida`  | CP-07    |
| D5  | Production (`ecd67f2`) sem o #132: lista de colaboradores mostra custo antigo                             | P2         | #132                         | CP-03    |
| D6  | `<= 15`/`<= 45` (030) × `< 15`/`< 45` (V2). **Sem defeito no CP-05**: a 030 só roda com o dobro desligado | P3         | leitura do código            | CP-05    |
| D7  | Caminho legado de contêiner aberto por URL (cobrança dupla). **Corrigido no CP-06** (cadastro encerrado) e **no CP-06B** (painel removido) | P2 | HANDOFF | CP-06/06B |
| D8  | Exclusões usam `window.confirm` nativo                                                                    | P3         | leitura do código            | CP-09    |
| I1  | `scripts/e2e-local.sh` usava `setsid`, ausente no macOS. **Corrigido** (`set -m`; G22–G25); macOS nativo não comprovado | infra | execução local 12/11 | CP-00B |

Defeitos do CP-01 (12/11/2026, sessão em nuvem), todos reproduzidos no E2E (RED), corrigidos e
revalidados (GREEN); detalhe, inventário e matriz em
[docs/qa/CP-01-autenticacao-e-permissoes.md](docs/qa/CP-01-autenticacao-e-permissoes.md):

| ID        | Defeito                                                                                   | Prioridade | Estado    |
| --------- | ----------------------------------------------------------------------------------------- | ---------- | --------- |
| D-CP01-01 | Login mostrava texto cru do Auth ("Invalid login credentials", "User is banned")          | P2         | corrigido |
| D-CP01-02 | Código TOTP errado mostrava "Invalid TOTP code entered" no `/mfa` e na ativação           | P2         | corrigido |
| D-CP01-03 | Duplo clique em "Enviar convite" e "Atribuir" executava a ação duas vezes                 | P2         | corrigido |
| D-CP01-04 | Duplo clique em "Continuar" da recuperação invalidava o próprio link                      | P2         | corrigido |
| D-CP01-05 | Convite para e-mail existente mostrava texto cru do Auth                                  | P3         | corrigido |
| D-CP01-06 | Botões só de ícone (gerenciar usuário, remover operação) sem nome acessível               | P3         | corrigido |

CP-01 (12/11/2026, sessão em nuvem, Linux): 35 casos E2E novos (`40-autenticacao`,
`41-permissoes`) com TOTP real e e-mail capturado no Mailpit local; E2E completo 98 testes (93
PASS, 0 FAIL, 5 FALHA CONHECIDA, 0 PULADO); 73/73 `test:*`; `sql-local` 52; sem SQL, RLS ou regra
financeira alterada e com MFA opcional mantido. Pendente de decisão: o Auth responde `user_banned`
antes de conferir a senha (revela conta revogada pela API do Auth, não pela tela). Não testados:
expiração natural do JWT, renovação isolada pelo `proxy.ts`, link expirado por tempo.

Defeitos do CP-06 (13/11/2026, sessão em nuvem), reproduzidos no E2E (RED) e corrigidos (GREEN);
modelo (operação fixa × serviço avulso; contêiner é tipo de avulso), inventário, D7 e decisões em
[docs/qa/CP-06-servicos-avulsos.md](docs/qa/CP-06-servicos-avulsos.md):

| ID        | Defeito                                                                                              | Prioridade | Estado                               |
| --------- | ---------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------ |
| D7        | `/containers/novo` (caminho legado) seguia aberto por URL e criava receita própria (adicional)       | P2         | corrigido (tela e servidor); banco: AUT-CP06-01 |
| D-CP06-01 | Registro antigo de contêiner + apontamentos da mesma operação: R$ 1.600 cobrados (certo: 1.000), sem aviso | P2   | corrigido (aviso)                    |
| D-CP06-02 | Duplo clique em "Registrar adicional": gravado, mas o diálogo ficava aberto (convite a reenviar)     | P2         | corrigido                            |
| D-CP06-03 | Bloco de adicionais apresentava contêiner e etiquetagem como adicionais                              | P3         | corrigido                            |

Decisões do CP-06 (nenhuma implementada): DEC-CP06-01 (catálogo de tipos de avulso), DEC-CP06-02
(unidade, quantidade e valor fechado), DEC-CP06-03 (custo do participante por serviço),
DEC-CP06-04 (duplicidade: avisar ou bloquear), DEC-CP06-05 (participante em dois avulsos).
Autorização pendente: **AUT-CP06-01** (encerrar a RPC de cadastro de contêiner no banco). Segue
**AUT-CP05-01** como risco financeiro pendente.

Defeitos do CP-07 (13/11/2026, sessão em nuvem), reproduzidos no E2E (RED no `7e8659f`) e
corrigidos (GREEN), só na interface — nenhum cálculo, SQL, migration, RLS ou contrato de RPC;
competências, conciliação ao centavo, emissão, concorrência, imutabilidade e decisões em
[docs/qa/CP-07-fechamento-e-faturamento.md](docs/qa/CP-07-fechamento-e-faturamento.md):

| ID        | Defeito                                                                                                | Prioridade | Estado    |
| --------- | ------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| D4        | Confirmação da fatura sem os dias de apontamento ainda abertos (o banco fatura dia aberto ou fechado)  | P2         | corrigido (aviso; sem bloqueio, DEC-CP07-01) |
| D-CP07-01 | Aba que perdeu a corrida da emissão seguia mostrando valor a faturar; mensagem genérica                | P2         | corrigido |
| D-CP07-02 | Falha de rede ao emitir: "TypeError: Failed to fetch" cru; resposta perdida sem mostrar a fatura gravada | P2       | corrigido |
| D-CP07-03 | Lançamento salvo depois da conferência: fatura diferente do conferido, sem aviso                       | P2         | corrigido (aviso; banco: AUT-CP07-01) |
| D-CP07-04 | Fatura complementar na mesma competência sem dizer que já existe fatura                                 | P2         | corrigido (aviso; DEC-CP07-02) |
| D-CP07-05 | Aviso de cobrança em dobro do CP-06 ausente na confirmação                                              | P2         | corrigido (aviso; DEC-CP06-04) |
| D-CP07-06 | CSV do Faturamento sem cliente no nome e com a presença crua do banco                                   | P3         | corrigido |
| D-CP07-07 | "Alterar condições"/"Alterar custo" abria antes de carregar o valor atual: formulário vazio, salvar travado (achado na CI) | P2 | corrigido |

Sessão 13 (13/11/2026, sessão em nuvem): **modelo de negócio consolidado** pelo esclarecimento
direto do responsável — duração da operação e forma de cobrança são independentes; três dimensões
(modalidade Fixa/Avulsa, regime diária/produção, tipo de serviço); mão de obra por diária pode ser
recorrente ou temporária; serviços por produção cobram quantidade executada × preço unitário
(10 contêineres × R$ 300 = R$ 3.000). Registrado em [docs/NEGOCIO.md §3A](docs/NEGOCIO.md) e
reconciliado em [docs/NEGOCIO_X_SISTEMA.md](docs/NEGOCIO_X_SISTEMA.md) (matriz de 16 itens).
**Cobrança por produção = lacuna funcional** que exige implementação específica (migrations, RPC
e regra financeira, com autorização); contêiner por unidade hoje **diverge** (sai como diária ×
participantes). Novas decisões: **DEC-PROD-01** (remuneração dos colaboradores em serviços por
produção), **DEC-PROD-02** (unidades, quantidade executada, parcial), **DEC-AV-01** (jornada na
temporária por diária), **DEC-AV-02** (um ou vários dias).

Defeitos do CP-08 (13/11/2026), reproduzidos no E2E (RED no `12f5528`) e corrigidos (GREEN), só
na interface — detalhe em
[docs/qa/CP-08-dashboard-relatorios-exportacoes.md](docs/qa/CP-08-dashboard-relatorios-exportacoes.md):

| ID        | Defeito                                                                                                    | Prioridade | Estado    |
| --------- | ---------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| D-CP08-01 | Custo dos serviços antigos de contêiner pela execução e receita pela competência: Dashboard/Relatórios com custo errado | P2 | corrigido |
| D-CP08-02 | Gráficos do Dashboard somam só apontamentos sem dizer                                                       | P3         | corrigido |
| D-CP08-03 | Relatório por operação sem Fixa/Avulsa                                                                      | P3         | corrigido |
| D-CP08-04 | Período invertido mostrado como falha de leitura                                                            | P3         | corrigido |
| D-CP08-05 | CSVs de lançamentos rotulados como exportação geral; sem modalidade e situação faturada                     | P3         | corrigido |

Riscos do CP-08: R-CP08-01 ("Diárias" conta domingo/feriado), R-CP08-02 (margem 0,0% sem receita),
R-CP08-03 (separador decimal dos CSV), R-CP08-04 (sem relatório por cliente e por tipo).

Decisões do CP-07 (nenhuma implementada): DEC-CP07-01 (dia aberto: avisar, confirmar ou
bloquear), DEC-CP07-02 (fatura complementar na mesma competência), DEC-CP07-03 (estados, ciclo,
cancelamento e detalhe da fatura; vínculo com a nota fiscal). Autorização pendente:
**AUT-CP07-01** (conferência do total esperado dentro de `gerar_fatura`: contrato de RPC e
migration). Uma fatura financeiramente incorreta (mesmo serviço como avulsa e registro antigo, ou
como adicional manual) **ainda pode ser emitida**: DEC-CP06-04 segue pendente. CN-D segue falha
conhecida (DEC-CP02-01).

CP-06B (13/11/2026, sessão em nuvem), por decisão do responsável ("o painel Container não é para
mais existir"): **D7-B** (P2) — mesmo com o cadastro novo encerrado, `/containers`, o detalhe e a
correção continuavam como painel próprio, por URL e pelos links do Faturamento. Corrigido sem
migration nem dado apagado: as URLs antigas conferem o admin e redirecionam para Operações; os
registros antigos ficam na seção recolhível "Serviços avulsos antigos" de Operações e em
`/operacoes/avulsos-antigos/<id>` (consulta, correção e cancelamento); o campo Tipo explica Fixa e
Avulsa e os tipos de avulso. Classificação estruturada do tipo **não implementada**: proposta com
alternativas e impacto em DEC-CP06-01 (exige migration). Detalhe e testes A–J em
[docs/qa/CP-06-servicos-avulsos.md](docs/qa/CP-06-servicos-avulsos.md#cp-06b--remoção-do-painel-independente-de-contêineres).

Defeitos do CP-05 (12/11/2026, sessão em nuvem), reproduzidos no E2E (RED) e corrigidos (GREEN);
inventário, matrizes de jornada, sábado/domingo/feriado, custo × receita, D6 e decisões em
[docs/qa/CP-05-apontamentos-e-regras-financeiras.md](docs/qa/CP-05-apontamentos-e-regras-financeiras.md):

| ID        | Defeito                                                                                              | Prioridade | Estado                        |
| --------- | ---------------------------------------------------------------------------------------------------- | ---------- | ----------------------------- |
| D1        | Saída antes da entrada em turno diurno gravada sem aviso (22h50); agora bloqueia até corrigir/confirmar | P1         | corrigido nas telas; banco: AUT-CP05-01 |
| D-CP05-01 | "Salvar o dia" gravava as linhas novas da equipe sem a tela distinguir linha gravada de sugerida     | P2         | corrigido (aviso)             |
| D-CP05-02 | Duas abas: a segunda sobrescrevia sem aviso o que a primeira gravou                                  | P2         | corrigido (tela do admin)     |

Decisões do CP-05 (nenhuma implementada): DEC-CP05-01 (limite de jornada em turno noturno e
registro da confirmação), DEC-CP05-02 (substituto fora da equipe), DEC-CP05-03 (linha nova nasce
presente), DEC-CP05-04 (jornada que cruza tipos de dia), DEC-CP05-05 (presença sem horário = diária
inteira). Autorização pendente: **AUT-CP05-01** (trava do D1 e da concorrência no banco, migration
com plano de compatibilidade no documento do CP-05).

Defeitos do CP-04 (12/11/2026, sessão em nuvem), todos corrigidos e revalidados; inventário,
matrizes de turnos e equipes e conciliação em
[docs/qa/CP-04-operacoes-turnos-equipes.md](docs/qa/CP-04-operacoes-turnos-equipes.md):

| ID        | Defeito                                                                                               | Prioridade | Estado    |
| --------- | ----------------------------------------------------------------------------------------------------- | ---------- | --------- |
| D3        | Duplo clique em "Salvar turno" criava 2 turnos (sem carregamento no botão)                            | P2         | corrigido |
| D-CP04-01 | Duplo clique em "Salvar operação" criava 2 operações                                                  | P2         | corrigido |
| D-CP04-02 | Cartão da avulsa, seletor de contrato e custo na equipe mostravam o valor do cadastro como "hoje"     | P2         | corrigido |
| D-CP04-03 | Turno "vira a meia-noite" com fim depois do início (32 h) e intervalo maior que o turno eram aceitos  | P2         | corrigido |
| D-CP04-04 | Cliente inativo e contrato encerrado/inativo sem identificação no formulário (agora identificados)    | P3         | corrigido |
| D-CP04-05 | Nome de operação/turno só com espaços aceito; espaços das pontas gravados                             | P3         | corrigido |
| D-CP04-06 | 12 rótulos soltos nos formulários de operação e turno                                                 | P3         | corrigido |
| D-CP04-07 | Excluir turno/operação não dizia que a equipe e os turnos saem junto                                  | P3         | corrigido |
| D-CP04-08 | Alocar/desalocar mostravam a mensagem crua do erro                                                    | P3         | corrigido |
| D-CP04-09 | Clique/Enter durante o fechamento do diálogo gravava de novo (cliente, colaborador, operação, turno)  | P2         | corrigido |

Decisões do CP-04: **DEC-CP04-01** (turno com início igual ao fim é aceito como 24 h, com aviso) e
alternativas registradas para a DEC-CP02-01 (contrato encerrado continua selecionável e cobrando;
a tela agora identifica e avisa, sem bloquear).

CP-04 (12/11/2026, sessão em nuvem, Linux): 17 casos E2E novos (`70-operacoes-turnos-equipes`, com o D3b);
fechamento R$ 2.450,00 de receita e R$ 1.490,00 de custo e relatório (Rui 620, Sol 720, Tito 150)
sem divergência ao centavo; E2E completo 149 testes (146 PASS, 0 FAIL, 3 FALHA CONHECIDA, 0
PULADO); 76/76 `test:*`; `sql-local` 52; sem SQL, RLS ou cálculo alterado.

Defeitos do CP-03 (12/11/2026, sessão em nuvem), todos reproduzidos no E2E (RED), corrigidos e
revalidados (GREEN); inventário, cenários de vigência e reconciliação de custos em
[docs/qa/CP-03-colaboradores-e-valores.md](docs/qa/CP-03-colaboradores-e-valores.md):

| ID        | Defeito                                                                                          | Prioridade | Estado    |
| --------- | ------------------------------------------------------------------------------------------------ | ---------- | --------- |
| D2        | "Alterar custo": trocar a data devolvia o campo ao custo antigo (vale para os três "Alterar")    | P1         | corrigido |
| D-CP03-01 | Com ~250+ colaboradores o `.in(...)` passava de 8 KB (414) e a lista mostrava o custo do cadastro | P2         | corrigido |
| D-CP03-02 | Lista e "Custo médio" mostravam o custo do cadastro como "hoje" ao carregar ou falhar            | P2         | corrigido |
| D-CP03-03 | Duplo clique em "Salvar colaborador" criava 2 colaboradores                                      | P2         | corrigido |
| D-CP03-07 | Duplo clique em "Salvar novo valor" gravava e deixava o diálogo aberto (intermitente)            | P2         | corrigido |
| D-CP03-04 | Nome só com espaços aceito; espaços das pontas gravados                                          | P3         | corrigido |
| D-CP03-05 | Custo negativo ia ao banco e voltava como erro genérico                                          | P3         | corrigido |
| D-CP03-06 | Rótulo "Status" solto do seletor                                                                 | P3         | corrigido |

CP-03 (12/11/2026, sessão em nuvem, Linux): 16 casos E2E novos (`60-colaboradores-custos`); custo
150 → 250 → 270 aplicado pela data e congelado no lançamento, hora extra pelo custo vigente
(312,50), retroativo recusado, dois profissionais, fechamento (custo R$ 1.312,50 × receita
R$ 1.593,75) e relatório (R$ 1.132,50 / R$ 180,00) sem divergência ao centavo; E2E completo 132
testes (128 PASS, 0 FAIL, 4 FALHA CONHECIDA, 0 PULADO); 75/75 `test:*`; `sql-local` 52; sem SQL,
RLS ou regra de custo alterada. Decisões do CP-02 seguem pendentes.

Defeitos do CP-02 (12/11/2026, sessão em nuvem), todos reproduzidos no E2E (RED), corrigidos e
revalidados (GREEN); inventário, matriz de valores e decisões em
[docs/qa/CP-02-clientes-e-contratos.md](docs/qa/CP-02-clientes-e-contratos.md):

| ID        | Defeito                                                                                     | Prioridade | Estado    |
| --------- | ------------------------------------------------------------------------------------------- | ---------- | --------- |
| D3        | Duplo clique em "Salvar cliente" criava 2 clientes (cliente; turno segue no CP-04)          | P2         | corrigido |
| D-CP02-01 | Duplo clique em "Salvar contrato" criava 2 contratos                                        | P2         | corrigido |
| D-CP02-02 | Contrato aceitava fim antes do início e ano 0001 (origem provável do `01/01/0001`)          | P2         | corrigido |
| D-CP02-03 | Lista de contratos mostrava o valor do cadastro como "hoje" ao carregar ou falhar           | P2         | corrigido |
| D-CP02-04 | Excluir cliente apaga em cascata operações e apontamentos não faturados sem avisar          | P2         | corrigido |
| D-CP02-05 | Nome só com espaços aceito; espaços das pontas gravados                                     | P3         | corrigido |
| D-CP02-06 | Falha de rede ("Failed to fetch") e erro da exclusão mostrados crus                         | P3         | corrigido |
| D-CP02-07 | 14 rótulos dos formulários de cliente e contrato soltos dos campos                          | P3         | corrigido |
| D-CP02-08 | "Salvar cliente" sem estado de carregamento                                                 | P3         | corrigido |

Decisões pendentes do CP-02: **DEC-CP02-01** (o fim do contrato e o status Inativo não limitam a
cobrança: dia depois do fim é lançado e cobrado; E2E `@falha-conhecida`), **DEC-CP02-02**
(excluir cliente sem histórico faturado apaga em cascata apontamentos não faturados; a tela agora
avisa) e **DEC-CP02-03** (saneamento do registro `01/01/0001` do HML, não lido nesta sessão).

CP-02 (12/11/2026, sessão em nuvem, Linux): 18 casos E2E novos (`50-clientes-contratos`), com
cenários de integração cliente → contrato → operação → apontamento → fechamento e vigências
250 → 300 → 320 conferidas ao centavo (fechamento R$ 2.340,00); E2E completo 116 testes (111 PASS,
0 FAIL, 5 FALHA CONHECIDA, 0 PULADO); 74/74 `test:*`; `sql-local` 52; sem SQL, RLS ou regra
financeira alterada.

CP-00B (12/11/2026, sessão em nuvem, Linux): baseline executável completa — lint, `tsc`, 72/72
`test:*`, build, `sql-local` 52 suítes, E2E local 63 testes (58 PASS, 0 FAIL, 5 FALHA CONHECIDA,
0 PULADO, 47/47 conferências financeiras) e 25/25 travas; I1 corrigido de forma portável (sem
`setsid`). **Execução nativa no macOS não comprovada**: o Mac deixa de ser requisito para avançar;
o ambiente principal passa a ser a sessão em nuvem e a CI.

### Situação

- `main` em `f6df1fb` (#133, E2E local), sobre `1c6042e` (#132, valores de hoje nas listas) e
  `1d60ca0` (#131), com migrations até a **051**. Integrados: #119 (046–050), #120
  (rótulos da avulsa), #121 (Containers fora do menu e do cartão; serviço pontual vira
  operação avulsa), #122 (valor acordado pelo contrato), #123 (confirmação antes de gerar
  fatura), #124 (este arquivo), #126 (rótulo "Faturado" no apontamento), #127 (plano de
  Production), #128 (tela de operação simplificada: localidade oculta com a resolução OFF e
  "Valor atual" + "Alterar valor"), #129 (migration 051: domingo e feriado em dobro com
  interruptor), #131 (pente fino das telas), #132 e #133 (12/11/2026, squash).
- **Production** (`ehkduqokntemtmqzdrbd`): **051 desde 11/11/2026**, interruptor de domingo/feriado
  em dobro **ligado**, resolução comercial OFF (035–050 com o
  [plano](docs/runbooks/producao-034-050.md), 051 com o
  [roteiro](docs/runbooks/dias-especiais-em-dobro.md)). Site `ecd67f2` em `admin.bslogisticas.com.br`
  (`dpl_2zSqLHxW42m693VWr9m4QeFPQWqb`); versão anterior para reversão:
  `dpl_d5xJB7s7CULxQXbFg94FVS9sJj1C`. Backup `pg_dump` de 11/11 com segunda cópia, guardado pelo
  responsável. Sem dados de negócio (1 cliente de teste "te"); 7 `profiles` e 7 `user_roles` órfãos;
  nenhum feriado cadastrado.
- **HML** (`qbnfcmrxmssnwkhaitgd`): **051**, interruptor de domingo/feriado em dobro **ligado**,
  resolução comercial OFF. **Limpo em 11/11/2026** (sem clientes, colaboradores, apontamentos ou
  faturas; contas e papéis preservados), pronto para o teste manual do responsável.
- **Vercel:** vínculos comprovados em 11/11/2026: Preview → HML, Production → Production.
- **Homologação de telas** em localhost → HML: 9 cenários, fluxo avulso e avulsa sem contrato
  com valor acordado, PASS.
- `npm audit`: 12 moderadas (glob/minimatch em ferramentas de build), dívida técnica para
  depois do piloto; nunca `npm audit fix --force`.

### Bloqueio do piloto: domingo e feriado com a resolução comercial OFF

Teste no HML em 11/11/2026, com reversão total: apontamento de 8 h num domingo (contrato com
diária R$ 250 e custo R$ 150) gravou **R$ 250,00 de cobrança, R$ 150,00 de custo e tipo do dia
"util"**. Com a resolução OFF o cálculo usa o caminho 030: domingo é dia útil; feriado só muda o
**pagamento** quando o contrato tem fator de feriado. A lista de feriados legada está **vazia**
em HML e Production.

Decisões do responsável (11/11/2026): domingo e feriado pagam as horas efetivas **em dobro**
(horas + 100%) **na cobrança e no pagamento**; correção pela migration 051 com **interruptor
desligado por padrão**, ligado primeiro no HML e depois em Production. A 051 está pronta em PR
Draft, mesclada no #129 e ligada no HML em 11/11/2026: domingo de 8 h com diária R$ 250 e custo
R$ 150 grava R$ 500 e R$ 300 (conferido no HML com o interruptor ligado, em transação desfeita). Roteiro de ativação:
[dias-especiais-em-dobro.md](docs/runbooks/dias-especiais-em-dobro.md).

Pendente: **cidade do cliente-piloto**, para os feriados municipais da lista única.

### Próxima etapa

1. Cadastrar os feriados (nacionais, de SC e os municipais da cidade do piloto), no HML e
   depois em Production, **antes** dos apontamentos (o tipo do dia fica congelado no
   lançamento).
2. Teste manual do responsável e ajustes.
3. Piloto. Contas operacionais reais só depois da matriz E2E de acesso.

Depois do piloto ou em paralelo, com autorização própria: limpar os órfãos de Production,
dependências do `npm audit`. O HML já foi limpo (o #125 pode ser fechado ou atualizado).
Decisões de negócio em aberto que não bloqueiam: tipos de serviço avulso e modalidade de
cobrança; três particularidades da Dynamis; C1–C6 da matriz.

### Testes E2E com Supabase local (#133, integrado em `f6df1fb`)

Infraestrutura Playwright contra o app em loopback e um Supabase **local descartável** no
GitHub Actions (job `e2e-local`, workflow próprio), sem secrets e sem caminho para HML ou
Production ([TESTES_E2E.md](docs/TESTES_E2E.md)). Cobre o ciclo pela tela (V1–V5 do #132, fixa ao
centavo, avulsa genérica, fechamento, exportações, fatura, Dashboard e Relatórios), a segurança do
operador e os defeitos conhecidos reproduzidos como FALHA CONHECIDA (B3 jornada atípica, duplo clique em cliente e
turno, valor digitado perdido ao trocar a data, confirmação da fatura sem aviso de dias abertos).
**CI verde nesse job não é homologação nem autoriza Production**; o teste no Preview segue
necessário para Auth real, borda da Vercel e dados do ambiente de homologação.

### Não fazer ainda

Sem começar o piloto, ligar a resolução comercial, dados reais, novo Supabase, `config push` ou
Gates 3–5 automáticos. Desligar o interruptor ou escrever em Production só com autorização
nominal. Sem `npm audit fix` ou troca de
versões fora do PR próprio.

### Fila funcional herdada da main — histórico, não tarefa ativa

Registro anterior preservado, sem atualizar status de PRs ou homologação por
inferência. Para a release ainda não integrada, consultar o HANDOFF do #111.

**Homologação integrada FIN-PR-11/12/13 em HML.** O PR
[#100](https://github.com/therunnas/bslogistica/pull/100) foi mergeado por squash em
`91513b91b11461ac48d8dfe6af118234bfb6fbc0` (CI de `main` verde). A matriz de 27 casos
foi executada em HML nas sessões 12 a 14: 27 PASS (A05 e E06 fechados na sessão 14,
com ressalvas registradas), 0 FAIL
([resultados](docs/financeiro/homologacao-fin-pr-13.md)). Resolução comercial de HML
restaurada para OFF. Production segue na 034 com o código da
`main` publicado; a decisão sobre esse risco é o primeiro passo. O estado e a próxima
ação exatos ficam no [HANDOFF](docs/HANDOFF.md).

**FIN-PR-12:** PR #99 mergeado por squash em `3e5b7b1`; CI de `main` e deploy
automático de Production verdes. A exportação continua **não homologada** com o
Excel real da Dynamis.

**FIN-PR-11:** HML recebeu 035–045 em 05/11/2026, após backup restaurado,
compatibilidade e dry-run; verificações pós-migration aprovadas. Os nove fluxos de
Containers continuam sem homologação real no navegador. Production continua na 034 e
qualquer implantação lá exige autorização específica.

Decisão do usuário (05/11/2026): concluir primeiro as funcionalidades pendentes
(FIN-PR-12 e FIN-PR-13) e fazer depois **uma homologação completa de ponta a
ponta**, seguida do manual de utilização e da preparação de Production.
Nenhuma funcionalidade é declarada homologada só por testes automatizados.

#### Fila anterior

1. **Concluído:** FIN-PR-13 mergeado (PR #100) e matriz E2E executada em HML
   (25 PASS, 1 PARCIAL, 1 BLOQUEADO, 0 FAIL); o PR documental #101 registra os resultados.
2. **Pendências:** revisão humana dos PRs #103 (documentação) e #105 (margem do Fechamento/Faturamento);
   modelos de e-mail do Dashboard; segunda cópia do backup de Production (criado, restaurado e
   ensaiado 034 → 045 em 05/11). Parecer atual: NO-GO condicional.
3. [Manual de uso](docs/MANUAL_DE_USO.md) redigido; [plano de Production
   034 → 045](docs/runbooks/producao-034-045.md) redigido, **sem execução** (gate próprio,
   com backup novo).

#### Pausadas anteriormente

- `DOC-MASTER-01/B2`: absorvida parcialmente por WORKFLOW-01; reavaliar somente
  lacunas documentais remanescentes, sem reabrir auditorias concluídas.
- `CHECK-UP-E2E-01`: HML já tem o schema 045; entra na homologação completa, com
  identidades de teste aprovadas.
- Auditoria de segurança C03: permanece futura e separada do fluxo financeiro.

Uma nova implementação só entra como ativa depois que a anterior tiver checkpoint
de encerramento ou pausa com motivo.

## Marcos concluídos

| Frente                                             | Entrega                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Migração para Next.js e reconstrução do Supabase   | Next.js 16 é a arquitetura definitiva; banco e Auth reconstruídos e validados                        |
| MFA AUTH-01D.R1                                    | TOTP opcional; fator verificado exige TOTP no login, com piso de MFA no banco                        |
| Recuperação de senha                               | confirmação deliberada (token não se consome em GET), prova HMAC e um único TOTP para contas com MFA |
| Proteção financeira no banco (`010`, `011`, `014`) | valores derivados por trigger, lastro faturado imutável, `break_minutes` não negativo                |
| Estado de MFA verificável pelo banco (`012`)       | `mfa_bloqueia_excecao_aal1()`                                                                        |
| Superfície operacional (`013`, `015`)              | cinco RPCs, papel dedicado com grants por coluna, elegível em AAL1 sem MFA ou AAL2                   |
| Interface operacional                              | camada de dados em `src/lib/operacional/`, papel e guards por rota, tela `/operacional`              |
| Guard role-aware                                   | uma só decisão de acesso, em `lerAcesso()`                                                           |
| Acesso direto restrito (`016`, `032`, `034`)       | tabelas de negócio exigem `admin` e piso de MFA da conta pelo PostgREST                              |
| Administração de usuários (`017`)                  | backend server-side, `admin_audit_log`, último admin protegido                                       |
| Telas `/usuarios` e `/configuracoes`               | gestão de usuários e papéis; ativação/desativação de MFA conforme o papel                            |
| Hardening de grants de `admin_audit_log` (`018`)   | menor privilégio na tabela de auditoria                                                              |
| Baseline e CI                                      | Next.js atualizado, testes estruturais alinhados, CI no GitHub Actions                               |
| Cabeçalhos e CSP                                   | CSP com nonce em enforcement, fontes auto-hospedadas, contraste do login                             |
| Dependências                                       | `npm audit` em 10/11/2026: 12 moderadas, 0 altas/críticas (glob/minimatch em ferramentas de build)   |

## Matriz E2E de acesso — pendente

**Objetivo:** provar de ponta a ponta, com contas reais, a política de acesso por
papel antes de existir o primeiro usuário `operacional`.

A matriz aprovada cobre:

- `admin` sem fator em AAL1 liberado · com fator em AAL1 bloqueado · após TOTP em AAL2 liberado;
- `operacional` sem MFA em AAL1 · `operacional` com fator verificado em AAL1
  **bloqueado** · `operacional` com MFA em AAL2;
- conta sem papel · `admin` + `operacional`;
- operação atribuída · operação não atribuída · operação sem turno;
- apontamento · folha fechada;
- financeiro inacessível ao operador · rotas administrativas bloqueadas;
- convite · troca de papel · último admin · auditoria;
- recuperação de acesso — **incluindo a variante sem MFA**, cuja arquitetura
  (`decidirMfaNaRecuperacao` devolve `prosseguir` para `mfa-ausente`) existe, mas
  que ainda não foi exercitada com conta real;
- logout/login e MFA.

**Gate:** o primeiro usuário `operacional` definitivo (do cliente) só é criado depois
da matriz.

**Situação do perfil operacional:**

- **Homologação do perfil (feita):** uma conta existente, que era admin, teve o papel
  de admin revogado e o `operacional` atribuído pela administração de usuários. Com
  ela, `/operacional` e a interface de apontamentos abriram, e o acesso direto a
  `/dashboard` foi barrado com redirecionamento para `/operacional`. Valida a
  navegação por perfil; **não** cria conta definitiva e **não** testa o fluxo de
  convite de operadores.
- **Criação por convite:** não exercitada nessa operação; segue na matriz E2E.
- **Contas definitivas do cliente:** preparação futura, depois da matriz.
- **Dados fictícios:** limpeza controlada antes da entrega, ainda pendente.
- A matriz E2E **não** está concluída.

## Próximas etapas

O estado factual e suas limitações estão em [Estado do projeto](docs/ESTADO_DO_PROJETO.md).
O checkpoint de integração dos PRs #90 e #91, a situação das migrations por
ambiente e da resolução comercial estão centralizados nesse documento.

### Gate documental e diagnóstico antes das próximas implementações

- [x] **CHECK-UP-AMB-01 (somente leitura):** projetos HML/Production e migration
      heads identificados; limites da auditoria de Vercel e vínculo Preview/HML
      registrados em [Ambientes](docs/AMBIENTES.md).
- [x] **WORKFLOW-01:** documentação e controles locais/CI integrados no PR #97
      (`314c08c`); controles administrativos de GitHub/Vercel continuam externos.
- [x] **CHECK-UP-REC-01 (HML):** backup lógico cifrado do HML restaurado e
      conferido localmente em 05/11; Production segue sem backup recente.
- [ ] **CHECK-UP-E2E-01:** concluir matriz real de papéis/MFA, recuperação e
      isolamento de dados, com contas e cenários de homologação aprovados.
- [ ] **FIN-VAL:** integrar FIN-PR-11/12/13 separadamente e reconciliar cálculo,
      fechamento e exportação com as evidências comerciais da quinzena Dynamis.

Os itens acima são **critérios de saída**, não autorização de migração,
ativação, deploy manual ou teste invasivo. Aprovação de CI e merge de PR não
substituem validação dos bancos. Consulte o
[checkpoint Git de 04/11](docs/ESTADO_DO_PROJETO.md#checkpoint-verificado-no-github--04112026)
para a última evidência de integração.

### Fase A — financeiro

1. **FIN-PR-09:** domingo/feriado ×2 e correções R1 integrados;
   [checkpoint e limites de implantação](docs/ESTADO_DO_PROJETO.md#fin-pr-09--mergeado).
2. **FIN-PR-10:** calendário nacional e territorial
   expansível, local real da execução, cobertura oficial e proteção do histórico,
   antes do FIN-PR-11. Resultados de validação, pendências e limites de autorização
   ficam exclusivamente em
   [Estado do projeto](docs/ESTADO_DO_PROJETO.md#fin-pr-10--calendário-territorial-nacional-histórico-do-pr-90).
3. **FIN-PR-11A/B/C integrados no Git:** desenho, domínio, backend e interface de
   containers (PRs #93–#96). O PR #96 foi mergeado por squash em
   `eb8cec9af11c4b0e314296ed776caf15c3764b5f`; a interface foi publicada pela
   automação da Vercel sem homologação real. Migration 045 continua ausente em
   Production, que segue na 034; HML recebeu 035–045 em 05/11. Homologação dos
   Containers incluída na homologação completa depois do FIN-PR-13.
4. **FIN-PR-12 implementado (não homologado):** botão "Excel do cliente" no
   Fechamento; [estado e evidências](docs/ESTADO_DO_PROJETO.md#fin-pr-12--excel-do-cliente-modelo-dynamis-05112026).
   Escopo aprovado: exportação no modelo de cliente Dynamis. Filtros em todas as
   colunas; `SUBTOTAL` dinâmico; diária, HE, adicional e total, com adicional
   efetivamente somado; datas `dd/mm/aaaa`, moeda brasileira, título
   “Fechamento – quinzena/mês”, ordem por colaborador/data e aba resumo por
   colaborador. Não incluir custo, lucro ou margem. Preservar Faturamento,
   Fechamento e Relatórios separados, sem quarta aba global de exportações.
5. **FIN-PR-13 implementado localmente, conciliação real pendente:** o runner
   integrado cobre apontamentos, diárias, HE, adicionais, Containers, fechamento,
   faturamento e os dois XLSX em banco local descartável. A base comercial aceita
   proveniência por arquivo e SHA-256 e compara cada componente sem tolerância. A
   modelo comercial Dynamis ainda não está acessível nas fontes locais autorizadas;
   portanto R$ 35.118,12 não foi usado como resultado de fixture e a conciliação
   real segue pendente.

### Fase B — ativação controlada

Validar jornada contratual de 8h e exigir saída quando houver entrada; classificar
turnos e funções das alocações; cadastrar tarifas padrão e diárias individuais;
revisar adicionais entre competências; fazer backup e validar restauração.

Antes da primeira migration em HML, executar integralmente, em uma execução,
`scripts/testar-compatibilidade-deploy.sh` e confirmar PASS nos cenários
versionados aplicáveis de 034–044 (sem presumir compatibilidade com o catálogo
remoto), além de verificar backup e a ordem real das migrations. Aplicar migrations em
HML somente com autorização específica, validar HML antes de Production e ativar
a resolução comercial somente por decisão separada.

### Fase C — segurança final

Conferir Supabase, Vercel e GitHub; comprovar isolamento Preview/HML; promover
ativação de MFA pelos admins; concluir matriz E2E e testes N3. Pentest em HML
somente após FIN-PR-13 e com autorização escrita do cliente; corrigir achados.

### Fase D — limpeza e entrega

Revisar órfãos, resíduos de testes, branches antigas e documentação; criar contas
operacionais definitivas somente após a matriz E2E; entregar o sistema.
Colaboradores ou contratos referenciados por diárias individuais devem ser
**desativados em vez de excluídos**.

Revisão trabalhista com contador da BS é pendência futura não bloqueante: adicional
noturno, intervalo intrajornada, limites de HE, domingo/feriado e CLT versus
diaristas. O sistema calcula custo previsto, não folha de pagamento.

## Riscos e pendências abertos

Os riscos de segurança, com condição de fechamento, estão em
[docs/SEGURANCA.md](docs/SEGURANCA.md) (seção "Riscos residuais"): proveniência
da taxa faturada, paridade manual `calcEntry()` × SQL, `TRUNCATE` de
`service_role` em `profiles` e `user_roles`, grants herdados, ausência de FK para
`auth.users`, e outros.

### Auditoria de segurança — andamento

Inventário original preservado: **21 frentes** (P0: 0 · P1: 7 · P2: 13 · P3: 1).
Concluídas em Production: **2** (C01, C02). Restantes: **19**. Próxima prioridade
de tratamento: **C03** (não iniciada). A severidade original não foi alterada.

### C02 — revogação de identidade e sessões (P1) — CONCLUÍDA EM PRODUCTION

- **Data:** 18/10/2026. **PR:** #65. **Merge commit:**
  `37bd0a9ded7de97ec3965a6a1bd17361c1f500ae`. **Migration:**
  `20261018120000_020_revogacao_de_identidade.sql`, aplicada por `supabase db push`
  (código 0) no projeto `ehkduqokntemtmqzdrbd`; 25 migrations registradas; a `019`
  **não** foi aplicada.
- **Resultado técnico:** `has_role()` e `is_staff()` só autorizam identidade
  utilizável (conta existente, não banida, sessão do JWT viva em `auth.sessions`);
  29 policies atualizadas; trigger do último admin conta só admins utilizáveis;
  privilégios previstos preservados. Modelo em [docs/SEGURANCA.md](docs/SEGURANCA.md).
- **Validação:** homologação local em instância isolada (14 suítes SQL, 1.235
  asserções, JWT/MFA/revogação com tokens reais); 15 verificações SQL de catálogo em
  Production; login de admin e tela `/operacional` funcionando; operador barrado no
  dashboard e levado a `/operacional`; deployment e checks da CI aprovados; sem erro
  identificado nos logs de Vercel, PostgreSQL e Auth **nas janelas que os planos
  atuais permitem consultar** (não é cobertura de todo o período desde a publicação).
- **O que NÃO foi feito em Production:** nenhum teste destrutivo. Banimento,
  exclusão e logout de contas reais **não** foram exercitados na publicação; esses
  comportamentos estão provados só na homologação local.
- **Recuperação:** `docs/runbooks/recuperacao-c02-020.md`. Reabre a C02; só com
  autorização expressa. Foi feito um backup técnico preventivo antes da `020`; ele
  **não** é backup integral restaurável comprovado.

#### Pendências relacionadas (não são regressões da C02)

- **Backup integral restaurável não comprovado** (plano Free).
- **Último admin:** banimento direto pela Auth Admin API não passa pelo trigger.
- **Registros órfãos** em `profiles` e `user_roles` (a `020` os faz negar, não os
  remove): exigem análise própria de retenção e limpeza controlada.
- **Revisão de segurança específica (Codex) não executada.**
- **Isolamento Preview/Production:** a proteção em código (gate no build e no
  runtime, CSP por ambiente, Sentry só em Production) foi implementada e testada
  localmente, sem exceção por variável. Falta comprovar com um Preview real na
  Vercel depois do merge e tratar os Previews anteriores à contenção, que seguem
  publicados.
- **Observabilidade histórica incompleta**, limitada pelas janelas de log dos planos.
- **Custo do trigger do último admin em Production** não medido.
- **Migration `019`** (fechamento): fora da C02; exige reordenar o timestamp, adaptar
  a suíte `014` e resolver conflitos nas branches da feature.

Outros itens, de menor gravidade:

- **Diagnóstico P3 no banco** — `sincronizar_chave_da_diaria` pode devolver
  `23503` "Folha não encontrada" numa tentativa em AAL1, porque o trigger é
  `SECURITY INVOKER` e lê `timesheets`, que a policy esconde. A operação
  continua bloqueada: é problema de mensagem, não de acesso.
- **Incidente de recuperação não reproduzido** — uma falha posterior ao
  `verifyOtp` redirecionou uma vez para `link-invalido` e a causa não foi
  comprovada. Não é bug aberto. Se voltar, o caminho é reinstrumentar o fluxo,
  não adivinhar.
- **Banco de Production com poucos dados** — "AAL1 leu 0 linhas" num banco vazio
  não distingue bloqueio de ausência de dado; testes em Production provam menos
  do que parecem. Os testes SQL locais é que medem as proteções.

### C05-B — histórico de vigências financeiras em 23/10/2026

**Histórico, não estado atual:** o conteúdo abaixo preserva o checkpoint de
23/10/2026, inclusive pendências e nomes de guards da época. Para o estado e a
política atuais, prevalecem o checkpoint em [Estado do projeto](docs/ESTADO_DO_PROJETO.md)
e [Segurança](docs/SEGURANCA.md).

**Situação em 23/10/2026** (fatos de Production em
[docs/ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md), seção "Vigências financeiras"):

| Frente                              | Implementado | Validado                             | Publicado                   | Pendente                                     |
| ----------------------------------- | ------------ | ------------------------------------ | --------------------------- | -------------------------------------------- |
| Banco (migrations `021` a `028`)    | sim          | ensaio local e conferência por lote  | **sim, em Production** (33) | —                                            |
| Motor atual (`010`)                 | sim          | preservado, funções e gatilho iguais | em uso (ligado)             | —                                            |
| Motor por vigência (`025`)          | sim          | estrutura conferida, nunca ativado   | instalado, **desligado**    | ativação: decisão de negócio, etapa própria  |
| Interfaces (PR B)                   | sim, branch  | 26 suítes Node; sem Preview          | **não**                     | PR B, Preview, merge e deploy (autorizações) |
| Vigências dos 7 cadastros pendentes | —            | —                                    | nenhuma cadastrada          | decisão de negócio: datas e valores          |

Regra de negócio: cada apontamento preserva as condições vigentes na data trabalhada;
reajuste futuro não reescreve diária anterior; faturado é imutável; nada é recalculado
em silêncio. Ordem das migrations:

- **021** e **022** (expansão do esquema): **aplicadas em Production** (L1, 23/10/2026).
- **023**: registro de vigências de contrato e de custo por RPC admin AAL2, trilha
  `financial_terms_audit` e imutabilidade das versões. **Aplicada em Production** (L2, 23/10/2026).
- **024**: vigência do valor acordado por operação (`operation_terms`, `operation_terms_id`
  no apontamento, RPCs espelho das da 023) e o **congelamento de jornada de turno usado,
  criado DESABILITADO**. **Aplicada em Production** (L2); nenhum efeito sobre o cálculo.
- **025**: motor financeiro por vigência, **desligado por padrão** e reversível
  (`financial_engine_settings`, `alterar_motor_vigencia`). Ligar troca 6 triggers de uma vez
  (motor antigo desabilitado; motor novo, 3 bloqueios de edição direta e congelamento de
  turno habilitados); desligar volta ao motor antigo, ressincroniza as colunas das taxas pela
  versão vigente hoje e deixa a trilha. **Aplicada em Production** (L3, 23/10/2026), com o motor
  **desligado**. Regras do motor ligado: preço pela versão da data trabalhada, sem
  fallback para a taxa atual; edição usa os preços congelados; apontamento legado só muda
  por `regularizar_apontamento_legado`; operação com legado recusa data anterior à ativação
  (R7); operação com apontamento não troca de contrato (R6).
  Falta não exige vigência (zerada, sem preço inventado); voltar a presença exige vigência na data;
  contrato antigo com jornada <= 0 entra no histórico com a jornada já normalizada (8 h).
- **Interfaces (U3–U7, branch `feat/c05b-interfaces-vigencia`; implementadas, NÃO publicadas):** contratos,
  colaboradores e operações sem contrato ganham histórico de vigências e registro de reajuste
  (com motivo, início e distinção entre alteração imediata e vigência futura) pelas RPCs das
  migrations 023 e 024. O estado do motor tem quatro valores (carregando, desligado, ligado,
  desconhecido): só `desligado` comprovado mantém a edição tradicional das taxas; ligado, a taxa
  muda por nova vigência; desconhecido (falha de consulta, permissão, resposta inválida ou gatilhos
  inconsistentes) deixa as condições financeiras somente para leitura. Apontamentos mostram o valor
  do banco, a prévia com o preço congelado ou a vigência da data trabalhada, e a origem; sem
  vigência a linha é bloqueada na tela. Turnos usados com jornada protegida só aceitam nome e
  status e oferecem "novo turno a partir deste". As telas **não** ligam, desligam, sincronizam nem
  regularizam o motor (fora do escopo). Dependência registrada: a tela do operador não mostra
  valores nem origem de vigência.

- **026** (cadastro atômico, C05-B5.1): `criar_contrato_com_vigencia`, `criar_colaborador_com_vigencia`
  e `criar_operacao_com_vigencia` criam a entidade e a vigência inicial na mesma transação (antes
  eram dois passos, e a falha do segundo deixava a entidade sem condição financeira). São
  `SECURITY INVOKER`: o INSERT segue a RLS e a vigência vai pelas RPCs 023/024, que revalidam admin
  AAL2 e gravam a trilha. **Aplicada em Production** (L4, 23/10/2026). As telas só a usam com o motor ligado (desligado, o INSERT direto continua). Os tipos
  do Supabase (`types.ts`) foram regenerados do schema local até a 026.

- **027** (ativação com divergência, C05-B5.5): com o motor desligado, a edição direta de taxa
  muda só a coluna, não a vigência cadastrada; a 025 ligava mesmo assim e o preço passava, em
  silêncio, da coluna para a vigência (não havia sobrescrita das colunas, só troca da fonte).
  `alterar_motor_vigencia(true, ...)` agora recusa (55000) enquanto existir cadastro cuja coluna
  difere da vigência ativa de hoje; a conferência roda dentro da transação, depois de habilitar os
  bloqueios (as tabelas já estão travadas), e a exceção desfaz tudo. Ausência de vigência segue
  como pendência; vigência futura e operação com contrato não entram; `p_aceitar_pendencias` não
  libera divergência. Lista para o admin: `divergencias_implantacao_vigencias()`. Corrigir é ato
  explícito (editar a coluna com o motor desligado, `sincronizar_colunas_legadas` ou registrar a
  vigência desejada). **Aplicada em Production** (L4). A trava de pendências continua contornável
  com `p_aceitar_pendencias = true`: a `027` fecha só a divergência.

- **028** (contrato da operação protegido, C05-B5.6): `operations.contract_id` não pode mais
  mudar (trocar, preencher ou remover) quando a operação tem apontamento ou valor acordado
  cadastrado (`operation_terms`), com o motor ligado **ou** desligado; a recusa é 55000 e manda
  criar uma nova operação. Antes só havia bloqueio ligado e só com apontamento (a 025): desligado a
  troca era livre, e ligado com valor acordado cadastrado e sem apontamento também. Operação sem
  histórico segue editável; contrato de outro cliente segue recusado pela 021. Trigger sempre
  habilitado, `SECURITY INVOKER`, `postgres` e `service_role` isentos como nas demais guardas.
  Segunda porta fechada (C05-B5.6A): excluir o contrato desvinculava a operação pelo `SET NULL` da
  chave estrangeira, que roda como dono e escapava do trigger; um `BEFORE DELETE` em `contracts`
  recusa (55000) a exclusão quando a operação ligada tem apontamento ou valor acordado cadastrado,
  sem exceção de papel. Contrato sem operação ou com operação sem histórico segue excluível.
  **Aplicada em Production** (L4). Vale desde já, com o motor desligado: o contrato das operações
  que têm apontamento não troca.

- **029** (regras confirmadas pela BS, C05-B8.10): **só no repositório**, não aplicada em nenhum
  banco remoto. Hora extra paga pelo valor-hora acordado por colaborador, custo proporcional na
  saída antecipada (cobrança inalterada), adicionais de serviço separados da diária e incluídos
  em `gerar_fatura`, e recusa de entrada igual à saída no banco. Detalhes, validação e regras
  ainda pendentes de decisão da BS em [docs/ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md).

- **030** (regras definitivas da BS, C05-B8.15): **só no repositório**. Arredondamento da hora extra
  cobrada (diário ou acumulado no período, por contrato), saída antecipada cobrada
  proporcionalmente, jornada de referência de sábado, pagamento em feriado com fator e calendário de
  feriados, e saldo de horas informativo. Detalhes e pendências no
  [ESTADO_DO_PROJETO.md](docs/ESTADO_DO_PROJETO.md).

- **Legado (C05-B5.7):** sem migration nova. As RPCs que já existiam bastam: `pendencias_implantacao_vigencias`
  (em uso e sem vigência para hoje), `divergencias_implantacao_vigencias` (027), `registrar_*` (023/024,
  data e motivo informados por quem decide), `sincronizar_colunas_legadas` e
  `regularizar_apontamento_legado` (prévia, só não faturado, com motor ligado). A lacuna comprovada era a
  administração não enxergar as listas: nenhuma tela as consumia. Nova tela só de leitura,
  `/implantacao-vigencias` (menu de conta do admin, `exigirAdmin`; só na branch, não publicada): pendências, divergências com o
  campo, a contagem de apontamentos legados e o link para a tela do cadastro. Não registra, não
  sincroniza, não liga, não mostra valor em reais. Apontamento e fatura antigos seguem como
  gravados (suíte SQL 025). Decisões que continuam do negócio: de qual data vale cada preço
  histórico, e se um apontamento legado deve ser regularizado (reprecificado pelas vigências).

Próximos passos da C05-B, em ordem e cada um com autorização própria:

1. Publicar a branch e abrir o PR B (ainda não existe).
2. Validar em Preview, que exige projeto Supabase de teste próprio no escopo Preview (não
   verificado) e uma conta admin em AAL2 nesse projeto.
3. Merge e deploy das interfaces. Depois, conferência só de leitura em Production.
4. Decidir as 7 pendências de vigência (4 colaboradores, 2 contratos, 1 operação sem contrato):
   data de início e valor de cada uma.
5. Só então, e em etapa separada, avaliar a ativação do motor, com as dependências abaixo.
6. Limpeza final do projeto (dados fictícios, ramos antigos): etapa futura, não iniciada.

Riscos abertos: um admin em AAL2 pode ligar o motor pela API com `p_aceitar_pendencias = true`
(há 1 admin); logs de Production não verificados depois dos lotes; o backup mais recente é anterior
à `025`; o dump não preserva event triggers. O PR #63 e a migration `019` seguem separados.

Dependências da ativação (ligar o motor da 025, não antes):

1. **Bloqueio da edição direta** de `contracts`, `employees` e `operations.agreed_amount`:
   hoje as telas gravam esses campos por `UPDATE`; bloquear antes quebra os formulários.
   Exige trocar os formulários pelas RPCs de vigência (data de início e motivo).
2. **Congelamento de turno usado:** habilitar `trg_shifts_congela_jornada_usada` junto com a
   tela de turnos, que tem de traduzir o erro `23514` e oferecer "novo turno" (hoje o
   formulário reenvia o objeto inteiro e funciona porque o trigger está desabilitado). A
   derivação grava `planned_minutes_snapshot` e o reaproveita enquanto o turno da folha
   não mudar.
3. **`operations.contract_id`:** resolvido pela 028 (não muda com apontamento ou valor
   acordado cadastrado). Sem histórico, a troca segue livre; isso é de propósito.
4. **Legado:** valores existentes são preservados; regularizar condição antiga exige
   admin, motivo e trilha (as RPCs da 023 e da 024 já fazem isso), nunca recálculo
   automático. Apontamento sem versão na data é recusado, sem fallback para a taxa atual.

## Decisões que não se reabrem

- **Não** reconstruir o Supabase, nem reaplicar migration já aplicada, nem editar
  uma aplicada. Mudança de banco exige migration nova.
- **Não** reintroduzir TanStack Start/Router, Vite, Nitro, Vinxi, Wrangler ou
  Lovable.
- **Não** afrouxar as proteções financeiras das migrations `010`/`011`.
- **Não** adicionar bloqueio de MFA em `user_roles` que impeça o login. Não
  remover policies restritivas sem substituição equivalente: preservar o piso
  `mfa_cotidiano_ok()` e as exigências de papel aplicáveis, sem enfraquecer o
  acesso administrativo nem ampliar o acesso operacional. MFA é opcional;
  conta com fator verificado exige TOTP no login.
- **Não** abrir a superfície do operador: nenhuma coluna financeira, `client_id`,
  documento ou telefone no retorno das RPCs; nenhum campo novo no JSON de escrita
  sem decisão de produto; nenhuma RPC de exclusão; nenhum `EXECUTE` dos helpers
  para `authenticated`.
- **Não** transformar o frontend em autoridade de segurança.
- **Não** reabrir a hipótese de incompatibilidade PKCE na recuperação: foi
  refutada pelo código-fonte do GoTrue.
- **Não** mudar sem entender as quatro linhas `if (…) return
falharDepoisDeVerificar()` da Server Action de recuperação.
- Decisões de produto congeladas da interface operacional: fonte de dados por
  papel, tela operacional separada, fechar e reabrir folha só pelo admin, nenhum
  fallback para operação sem turno, `admin` + `operacional` tratado como admin e
  tipos gerados do banco conferidos antes de sobrescrever.
- **Não** tocar no site institucional, **não** ativar signup público, **não**
  usar `supabase config push`, **não** modificar DNS sem confirmação.

## Como retomar

1. Leia o [CLAUDE.md](CLAUDE.md).
2. Leia o [HANDOFF](docs/HANDOFF.md) e confirme tarefa, gate e autorização.
3. Leia este arquivo e, antes de qualquer mudança de autorização, a seção
   "Superfície operacional" e "RLS e banco" de [docs/SEGURANCA.md](docs/SEGURANCA.md).
4. Confira `git status`, `HEAD`, PR e o ambiente pertinente.
5. Não reaudite o projeto inteiro sem necessidade.
6. Se o estado real divergir do que está escrito, atualize o diagnóstico antes de
   executar a operação afetada.
