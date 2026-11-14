# Handoff ativo

<!-- workflow-handoff:v1 -->

**GATE-FIN-03 (sessão 19, PR Draft empilhado sobre o #135, branch `fix/gate-fin-03-migration-053`): migration 053 recusa no banco intervalo maior que o tempo entre entrada e saída (SQL 090 I5 → SEGURO), em todos os caminhos de gravação — diagnóstico corrigido: com o motor ligado (HML e Production) o núcleo já recusava a jornada zerada com mensagem técnica; o I5 era aceito com o motor desligado — implementada e testada só no Supabase local e na CI, NÃO aplicada em HML nem em Production. GATE-FIN-02 (sessão 18, PR Draft empilhado sobre o #134, branch `fix/gate-fin-02-migration-052`): migration 052 encerra no banco o cadastro pela RPC legada de contêiner (AUT-CP06-01), com as fixtures SQL e E2E do histórico pela dona da função — implementada e testada só no Supabase local e na CI, NÃO aplicada em HML nem em Production. QA-BS-01 — auditoria, correção e estabilização integral. CP-00, CP-00B e CP-01 a CP-09 PASS (local e CI); CP-10 PASS COM PENDÊNCIAS BLOQUEANTES (local). CP-10 (sessão 15, segurança, integridade e infraestrutura): matriz de autorização pela API e varredura das 65 RPCs SECURITY DEFINER sem nenhuma elevação; D-CP10-01 (X-Powered-By) corrigido; RISCOS REPRODUZIDOS no banco — jornada impossível aceita pelas RPCs das telas com o motor ligado (R$ 953,13 num dia, AUT-CP05-01), emissão diferente do conferido (AUT-CP07-01), o mesmo contêiner cobrado 4× (DEC-CP06-04), RPC legada de contêiner ainda cria receita (AUT-CP06-01), cobrança depois do fim do contrato (DEC-CP02-01), sem cancelamento de fatura (DEC-CP07-03); matriz de gates do CP-09 substituída: demonstração fictícia GO condicionado, **piloto financeiro real NO-GO**; nenhuma migration, RPC, RLS, grant ou regra financeira alterada. CP-09 (sessão 14, interface, clareza e consistência): D8 — exclusões pelo diálogo da tela, não mais `window.confirm`, sem liberar nenhuma exclusão antes recusada —, R-CP07-06 (“Alterar” de contrato que só começa no futuro parte da versão da data), R-CP08-01 a 03 (texto de “Diárias”, margem sem receita, CSV com vírgula decimal, valores iguais), 12 rótulos ligados, título do operador e a Nova operação dizendo que a cobrança é por diária (produção não existe); matriz de gates financeiros em docs/qa/CP-09; nenhuma migration, RPC, RLS, grant ou regra financeira alterada. Sessão 13: modelo de negócio consolidado pelo responsável — duração e forma de cobrança são independentes; três dimensões (modalidade Fixa/Avulsa, regime diária/produção, tipo de serviço); produção (10 contêineres × R$ 300) é lacuna funcional, contêiner por unidade hoje DIVERGE (sai como diária); NEGOCIO.md §3A e matriz de 16 itens em NEGOCIO_X_SISTEMA.md. CP-08 (dashboard, relatórios e exportações) corrigiu D-CP08-01 (custo dos serviços antigos pela competência, como a receita) e mais 4 defeitos de rótulo e interface; nenhum cálculo, SQL ou RPC alterado. CP-07 (fechamento e faturamento) corrigiu D4 — a confirmação da fatura mostra dias fechados, abertos e sem apontamento, relida antes de abrir, sem bloquear — e mais 7 defeitos de interface (D-CP07-01 a 07: aba que perdeu a corrida, falha de rede e resposta perdida, emissão diferente do conferido, fatura complementar, duplicidade na confirmação, CSV, "Alterar" antes de carregar o valor); competências, conciliação ao centavo, concorrência e imutabilidade comprovadas; nenhum cálculo, SQL ou RPC alterado; uma fatura com duplicidade ainda pode ser emitida (DEC-CP06-04). CP-06B removeu o painel independente de Contêineres (decisão do responsável: contêiner é tipo de serviço avulso, cadastrado em Operações → Nova operação → Avulsa): URLs antigas redirecionam para Operações, registros antigos consultáveis, corrigíveis e canceláveis em Operações, nada apagado, sem migration. CP-06 (serviços avulsos) corrigiu D7: o cadastro separado de contêiner (caminho legado, aberto por URL) foi encerrado na tela e no servidor — contêiner é tipo de serviço avulso, registrado como operação Avulsa; registros antigos preservados para consulta, correção e cancelamento — e mais 3 defeitos (D-CP06-01 a 03). Incidente herdado: 4 chamadas VAZIAS à API do HML por engano no CP-04/CP-05, sem SQL executado. Próximo: CP-11, com nova autorização. AUT-CP05-01, AUT-CP06-01, AUT-CP07-01, D5 e as decisões DEC-CP02-01 a 03, DEC-CP04-01, DEC-CP05-01 a 05, DEC-CP06-01 a 05, DEC-CP07-01 a 03, DEC-PROD-01/02 e DEC-AV-01/02 seguem abertos.** Production e HML seguem como em PROD-051-01 (051, dobro ligado); reconferir antes de agir.

## Identificação

| Campo | Valor |
| --- | --- |
| Etapa | QA-BS-01 — auditoria, correção e estabilização integral, por checkpoints CP-00 a CP-12 (plano e defeitos em [PROGRESS](../PROGRESS.md#qa-bs-01--checkpoints)) |
| Gate atual | GATE-FIN-03 — migration 053, gate LOCAL + CI concluído (sessão 19). HML e Production da 052 e da 053: não autorizados. QA-BS-01: CP-10 concluído com pendências bloqueantes; CP-11 não iniciado |
| Último gate concluído | GATE-FIN-03 local + CI (14/11/2026, sessão 19); antes, o GATE-FIN-02 local + CI (sessão 18), o planejamento GATE-FIN-01/01B (sessões 16–17, sem alteração) e o CP-10 (sessão 15), CP-09, CP-08, CP-07, CP-06B, CP-06, CP-05, CP-04, CP-03, CP-02, CP-01, CP-00B, CP-00 e a RECONCILIACAO-134 |
| Worktree | Sessão em nuvem (ambiente principal a partir da sessão 03): worktree isolado `/home/user/bslogistica-qa134` (efêmero), com Docker local da sessão. Sessão anterior no Mac: worktree na pasta temporária do Claude Code (`.../scratchpad/bs-qa`). Descobrir de novo na retomada; o checkout original (`fix/auditoria-bs-202610`) não é o desta tarefa |
| Branch | `fix/gate-fin-03-migration-053` (esta), criada do HEAD `458108397a4a2bba253283f26b8d9daee462e56c` de `fix/gate-fin-02-migration-052` (#135, intacto), que nasceu do HEAD `9a5702fec9097d144f5cc2a7289d785ef65a8b49` de `fix/qa-bs-01-estabilizacao` (#134, intacto). O #134 segue a branch da QA-BS-01, criada de `origin/test/e2e-playwright-local` e reconciliada com a `main` por merge |
| Base | main `f6df1fbf58e8eb34648e2328b926ef99c7ad7164` (squash do #133, sobre `1c6042e`, squash do #132) |
| HEAD validado | 458108397a4a2bba253283f26b8d9daee462e56c (origem: GATE-FIN-02 no #135; CI [`validar`](https://github.com/therunnas/bslogistica/actions/runs/43596952757/job/132453449216), [`sql-local`](https://github.com/therunnas/bslogistica/actions/runs/43596952757/job/132453449484) e [`e2e-local`](https://github.com/therunnas/bslogistica/actions/runs/43596952738/job/132453451434) SUCCESS — 238 testes, 237 PASS, 0 FAIL, 1 FALHA CONHECIDA, 0 PULADO, 1678 s) + o diff da sessão 19, validado na sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check`, Prettier (salvo os três Markdown já fora do padrão antes) e build PASS; 82/82 `test:*`; travas 25/25; `sql-local` 54 suítes PASS (053 nova: 31/31; 090: 33 SEGURO, 13 RISCO); `npm run e2e:local` 242 testes (241 PASS, 0 FAIL, 1 FALHA CONHECIDA — CN-D —, 0 PULADO, 1716 s, sem rede externa); Docker 0 containers no fim; revalidado na CI no HEAD do PR empilhado |
| Alterações não commitadas | Nenhuma na sessão em nuvem (`project_id` trocado só para os testes e restaurado; `supabase/.branches/` não versionado). No Mac (sessão anterior): `supabase/config.toml` com `project_id = "bs-e2e-qa01"` (**nunca commitar**) e `supabase/.branches/` |
| PR | PR do GATE-FIN-03 (Draft, **empilhado**: base `fix/gate-fin-02-migration-052`; número no checkpoint seguinte). Pais: #135 (Draft, base `fix/qa-bs-01-estabilizacao`) e #134 (Draft, base `main`), intactos nesta sessão. Integrados na `main`: #132 (`1c6042e`) e #133 (`f6df1fb`). Aberto e não tocado: #125 |
| Ambiente-alvo | Local (Supabase local descartável) e CI. Preview e Production: nenhum acesso. **HML: nenhum acesso autorizado na QA-BS-01; houve 4 chamadas vazias por engano à API de gerenciamento do HML (2 no CP-04, 2 no CP-05), sem SQL executado** (ver CP-05) |
| Última ação comprovada | Sessão 19 na sessão em nuvem: auditoria dos caminhos de gravação; RED (SQL 053 19/31, 090 I5, E2E IJ1–IJ4 — este revelou que o núcleo do motor ligado já recusava com 22023); migration 053 + rollback ensaiado; GREEN (SQL 54/54, 090 33 SEGURO e 13 RISCO; E2E completo 242); preflight local; encerramento sem sobras |
| Próxima ação exata | Decisão do responsável sobre aplicar a 052 e a 053 no HML (autorização nominal; antes, backup, preflight da 053 e conferência de catálogo/ACL por leitura autorizada) — não autorizada. Em paralelo, decisões do GATE-FIN-01B (DEC-CP05-01 para a 054/058, DEC-CP07-03, DEC-CP06-04, DEC-CP02-01). Não iniciar 054–060, CP-11 nem CP-12 sem autorização |

## Estado atual para retomada

| Campo | Estado comprovado / referência |
| --- | --- |
| Main | `f6df1fb` (#133: E2E com Supabase local isolado), sobre `1c6042e` (#132: valores de hoje nas listas, correção e antecipação pelo "Alterar"), `1d60ca0` (#131) e `8c493a5` (#128): código até 050, rótulos da avulsa, Containers fora do menu, valor acordado pelo contrato, confirmação antes de gerar fatura, rótulo "Faturado", tela de operação simplificada. `vercel.json` mantém `main:false` |
| HML | **051 desde 11/11/2026, `dias_especiais_em_dobro=true`, limpo em 11/11/2026 (só contas e configuração)** (050 desde 09/11/2026); `tarifas_por_funcao=false`; `vigencia_ativa=true`. Backup lógico pré-aplicação (59 tabelas) entregue ao usuário, fora do Git |
| Production | **051 desde 11/11/2026, `dias_especiais_em_dobro=true`** (035–050 no mesmo dia, 16/16 PASS). Site `ecd67f2` (`dpl_2zSqLHxW42m693VWr9m4QeFPQWqb`); reversão do site: `dpl_d5xJB7s7CULxQXbFg94FVS9sJj1C` (`8c493a5`). Backup `pg_dump` de 11/11 (antes da 035) com o responsável. Sem dados de negócio; lista de feriados vazia |
| Preview | Deployment da branch `claude/jolly-allen-fqechw`; Preview → HML comprovado pela leitura das variáveis na Vercel (11/11/2026). Este container não abre `vercel.app` (proxy). Configuração registrada em [AMBIENTES.md](AMBIENTES.md) |
| Negócio | [NEGOCIO.md](NEGOCIO.md) e [matriz](NEGOCIO_X_SISTEMA.md); C1–C6 seguem pendentes e não bloqueiam o piloto com resolução OFF |
| Dynamis | Conciliação técnica encerrada: a planilha usa datas 1904 (01–15/09/2026; o E06 leu 2022). Com intervalo de 2h em dia útil o V2 reproduz HE e arredondamento; diferenças comprovadas: saída antecipada −R$ 338,04 (49 dias), sábado 05/09 +R$ 46,88 (2 linhas), arredondamento por lançamento +R$ 0,075. Pendentes comerciais da Dynamis: intervalo do dia útil, saída antecipada, os dois sábados. Regras gerais da BS inalteradas |

## Última tarefa

| Campo | Valor |
| --- | --- |
| Tarefa executada | GATE-FIN-03 — migration 053, gate LOCAL + CI (14/11/2026, sessão em nuvem, sessão 19), autorizado pelo responsável: branch própria a partir do HEAD validado do #135, PR Draft empilhado, migration 053 (recusa intervalo maior que o tempo entre entrada e saída), testes RED/GREEN SQL e E2E, preflight local, runbook de rollback, correções documentais A/B/C herdadas da 052, CI. Detalhe em [docs/qa/GATE-FIN-03-migration-053.md](qa/GATE-FIN-03-migration-053.md) |
| Resultados e testes comprovados | **Diagnóstico corrigido:** com o motor por vigência ligado (semente E2E; HML e Production pelo ESTADO_DO_PROJETO) o núcleo (035) já recusava a jornada zerada com 22023 `nucleo:zero_minuto_com_horarios`; o I5 do CP-10 só era aceito com o motor desligado (SQL 090 desliga o motor). **RED:** SQL 053 nova 19/31 falham (ex.: RPC do admin e do operador gravaram); 090 só o I5 (`aceito\|0\|1`); E2E IJ1–IJ3 recusados pelo núcleo (22023), IJ4 em cascata. **Com a 053:** SQL 053 31/31; 090 33 SEGURO e 13 RISCO (I5 → SEGURO; I1 e I7 seguem RISCO); inventários de gatilhos (010 I1, 018 V4, 019 V4) e de migrations (spec 00 e 4 suítes `test:*`) atualizados; rollback ensaiado (volta a falhar de propósito; `schema_migrations` intacto) e 053 reaplicada duas vezes (idempotente); preflight local: 133 apontamentos, 0 violações, e detecção provada com uma linha violadora sintética numa transação desfeita. lint, `tsc`, `check:workflow`, `git diff --check`, Prettier e build PASS; 82/82 `test:*`; travas 25/25; `sql-local` 54 suítes PASS; `npm run e2e:local` 242 testes (241 PASS, 0 FAIL, 1 FALHA CONHECIDA — CN-D —, 0 PULADO, 1716 s, sem rede externa). A 1ª execução completa do E2E falhou da spec 90 em diante porque o IJ4 encerrava a sessão da API com `signOut()` global e derrubava a sessão do admin das specs seguintes; corrigido para `scope: "local"`, como as demais specs, e repetido |
| Código e PR afetados | `supabase/migrations/20261120120000_053_recusar_intervalo_maior_que_jornada.sql` (novo); `supabase/preflight/053_intervalo_maior_que_jornada_preflight.sql` (novo, só leitura); `docs/runbooks/rollback-recusar-intervalo-maior-que-jornada.sql` (novo) e índice; `supabase/tests/053_intervalo_maior_que_jornada.sql` (nova); SQL 090 (I5 SEGURO, chamada e contagem em comandos separados), 010, 018 e 019 (inventário de gatilhos); `e2e/specs/80-apontamentos-financeiro.spec.ts` (IJ1–IJ4; atribuição do operador extraída para função), spec 00 (58 migrations); `test:configuracoes`, `test:motor-vigencia`, `test:interfaces-vigencia`, `test:regras-definitivas` (inventário). Docs: `docs/qa/GATE-FIN-03-migration-053.md` (novo), `docs/SEGURANCA.md`, `PROGRESS.md`, `docs/TESTES_E2E.md`, rollback da 052 (B), este arquivo. **Nenhuma outra migration (001–052 intactas), RPC, RLS, grant, contrato, regra financeira, cálculo, faturamento ou rota do app.** PR Draft empilhado sobre o #135 |
| Ambientes envolvidos | Sessão em nuvem: Docker local (0 containers antes); Supabase locais `bs-fin03-red`, `bs-fin03-green`, `bs-fin03-final` (SQL), `bs-e2e-cp04` (iteração), `bs-e2e-fin03` e `bs-e2e-fin03b` (E2E), criados e encerrados pelo próprio `project_id`; `config.toml` restaurado. GitHub (CI). **HML, Preview e Production: nenhum acesso**; nenhuma API de gerenciamento remoto; nenhum SQL remoto; preflight só local. O incidente das 4 chamadas vazias (CP-04/CP-05) segue registrado |
| Pendências e decisões | **053:** aplicar no HML e depois em Production exige autorização nominal por ambiente (antes: backup, preflight remoto autorizado e conferência de catálogo e ACL). **Limite exato** (intervalo = duração): sem regra nova; o núcleo do motor ligado segue recusando, o desligado segue gravando. **Seguem RISCO:** I1 (AUT-CP05-01, DEC-CP05-01, 054/058) e I7 (versão obsoleta); AUT-CP07-01, DEC-CP06-04, DEC-CP07-03, DEC-CP02-01. **Correções da 052:** (A) HEAD validado da sessão 18 = `458108397a4a2bba253283f26b8d9daee462e56c`; (B) o rollback da 052 não sugere mais apagar o registro em `schema_migrations` — histórico preservado, reversão registrada como operação distinta; (C) a 052 encerra a criação direta pela RPC antiga, mas `corrigir_servico_container` continua podendo criar um substituto de registro histórico: o caminho legado não foi integralmente eliminado |
| Próxima ação exata | Decisão sobre aplicar a 052 e a 053 no HML (não autorizada). Não iniciar 054–060, CP-11 nem CP-12 sem autorização |
| Autorizações e proibições | Autorizado e usado: branch nova a partir do HEAD do #135, PR Draft empilhado, migration 053, testes RED/GREEN SQL e E2E, runbook de rollback da 053, documentação e HANDOFF, correções documentais herdadas da 052 sem mudar o comportamento dela, regressão local completa, commit, push e CI. Proibidos e não feitos: HML e Production, APIs de gerenciamento remoto, migrations 001–052, branches do #134 e do #135, 054–060, jornada máxima comercial, cálculo de diária/HE/custo, domingo e feriado, permissões/RLS/contratos, controle de versão, faturamento e cancelamento de fatura, merge, rebase, force push, deploy, CP-11 e CP-12 |

### Tarefa anterior — GATE-FIN-02 sessão 18 (14/11/2026, sessão em nuvem; HEAD validado `458108397a4a2bba253283f26b8d9daee462e56c`, PR #135, [`validar`](https://github.com/therunnas/bslogistica/actions/runs/43596952757/job/132453449216), [`sql-local`](https://github.com/therunnas/bslogistica/actions/runs/43596952757/job/132453449484) e [`e2e-local`](https://github.com/therunnas/bslogistica/actions/runs/43596952738/job/132453451434) SUCCESS — 238 testes, 237 PASS, 0 FAIL, 1 FALHA CONHECIDA, 0 PULADO, 1678 s)

| Campo | Valor |
| --- | --- |
| Tarefa executada | GATE-FIN-02 — migration 052, gate LOCAL + CI (14/11/2026, sessão em nuvem, sessão 18), autorizado pelo responsável: branch própria a partir do HEAD validado do #134, PR Draft empilhado, refatoração das fixtures SQL e E2E dependentes da RPC legada de contêiner, migration 052 (`REVOKE EXECUTE` de `registrar_servico_container` para os papéis externos), runbook de rollback, testes locais, CI. Detalhe em [docs/qa/GATE-FIN-02-migration-052.md](qa/GATE-FIN-02-migration-052.md) |
| Resultados e testes comprovados | **Sem a 052 (só fixtures):** SQL 53/53 (090: 25 SEGURO, 15 RISCO, inalterada); E2E 237 (236 PASS, 0 FAIL, 1 FALHA CONHECIDA, 0 PULADO, 1677 s). **RED:** SQL 045 (`registrar pela API bloqueia admin sem MFA AAL1`: obtido uuid) e 090 C1 (`<uuid>|1`), C4 (`authenticated` com EXECUTE). **Com a 052:** catálogo local — `registrar_servico_container` com EXECUTE só da dona `postgres`; `corrigir_`/`cancelar_` com `postgres, authenticated`; rollback ensaiado (devolve `authenticated`) e 052 reaplicada (idempotente). lint, `tsc`, `check:workflow`, `git diff --check`, Prettier e build PASS; 82/82 `test:*` (`test:legado-local` 13, novo); travas 25/25; `sql-local` 53 suítes PASS (090: 32 SEGURO, 14 RISCO); `npm run e2e:local` 238 testes (237 PASS, 0 FAIL, 1 FALHA CONHECIDA — CN-D —, 0 PULADO, 1671 s, sem rede externa); Docker 0 containers e 0 volumes no fim |
| Código e PR afetados | `supabase/migrations/20261119120000_052_encerrar_cadastro_container_legado.sql` (novo); `docs/runbooks/rollback-encerrar-cadastro-container-legado.sql` (novo) e índice dos runbooks; `e2e/apoio/legado-local.ts` (novo: a única escrita do E2E fora da interface, exceção documentada); specs 90, 95, 97 (fixture pelo helper), 99 (M8), 00 (57 migrations); SQL 045, 046, 047, 049, 050 e 090 (fixtures pela dona; 045 divide API × guarda interna; 090 C1 vira SEGURO e ganha C1b, C5–C9); `scripts/testar-legado-local.mjs` (novo, `test:legado-local`, na CI); inventário de migrations em `test:configuracoes`, `test:motor-vigencia`, `test:interfaces-vigencia`, `test:regras-definitivas`; scripts manuais de concorrência (fixture pela dona). Docs: `docs/qa/GATE-FIN-02-migration-052.md` (novo), `PROGRESS.md`, `docs/TESTES_E2E.md`, este arquivo. **Nenhuma outra migration, RPC, RLS, grant, regra financeira, dado histórico ou rota do app; `corrigir_` e `cancelar_servico_container` intactas.** PR #135 (empilhado sobre o #134, que não foi alterado) |
| Ambientes envolvidos | Sessão em nuvem: Docker local (0 containers e 0 volumes antes); Supabase locais `bs-fin11-g02a`, `bs-fin11-g02r`, `bs-fin11-g02g` (SQL), `bs-e2e-g02a`, `bs-e2e-g02b` (E2E), criados e encerrados pelo próprio `project_id`; `config.toml` restaurado. GitHub (CI). **HML, Preview e Production: nenhum acesso**; nenhuma API de gerenciamento remoto; nenhum SQL remoto. O incidente das 4 chamadas vazias (CP-04/CP-05) segue registrado |
| Pendências e decisões | **052:** aplicar no HML e depois em Production exige autorização nominal por ambiente (antes: backup e conferência de ACL por leitura autorizada). **Resíduo:** `corrigir_servico_container` ainda cria substituto com receita para registro antigo não cancelado e não faturado (Production não tem; HML tem `HOMOLOG-SINT`, não contados). **Seguem bloqueantes do piloto real:** AUT-CP05-01, AUT-CP07-01, DEC-CP06-04, DEC-CP07-03, DEC-CP02-01 (SQL 090, 14 RISCO); decisões e gates do GATE-FIN-01B |
| Próxima ação exata | Decisão sobre aplicar a 052 no HML (não autorizada). Não iniciar a 053, o CP-11 nem o CP-12 sem autorização |
| Autorizações e proibições | Autorizado e usado: branch própria a partir do #134, PR Draft empilhado, refatoração só das fixtures dependentes da RPC legada, migration 052 (só o REVOKE), runbook de rollback, testes locais, commit e push só na branch nova, CI, documentação e HANDOFF. Proibidos e não feitos: alterar o #134, migrations 053+, cálculos e regras financeiras, outras RLS/grants/RPCs, excluir histórico, remover `corrigir_`/`cancelar_servico_container`, módulo de Contêineres, rota ou função de teste no app, HML, Production, SQL e APIs remotas, merge, rebase, force push, deploy, configurações remotas, CP-11 e CP-12 |

### Tarefa anterior — QA-BS-01 sessão 15, CP-10 (14/11/2026, sessão em nuvem; HEAD `9a5702fec9097d144f5cc2a7289d785ef65a8b49`, PR #134, `validar`, `sql-local` e `e2e-local` SUCCESS)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 sessão 15 — CP-10, segurança, integridade e infraestrutura (14/11/2026, sessão em nuvem), autorizado pelo responsável. Inventário da superfície (25 páginas, 5 rotas, 7 módulos de Server Actions, 31 tabelas, 186 funções, 65 DEFINER executáveis por `authenticated`); autenticação, MFA, cookies e sessões; matriz de autorização pela API; RLS, grants e RPCs; integridade dos apontamentos e do faturamento; duplicidade; RPC legada de contêiner; contratos encerrados; segurança da aplicação; infraestrutura; revisão crítica dos gates financeiros (cenários A e B). Detalhe em [docs/qa/CP-10-seguranca-integridade-infraestrutura.md](qa/CP-10-seguranca-integridade-infraestrutura.md) |
| Resultados e testes comprovados | **Comprovado seguro:** spec 99 (12 casos) — 31 tabelas × SELECT/INSERT/UPDATE/DELETE × operacional, sem papel e anônimo sem nada lido ou gravado; 65 RPCs DEFINER recusadas para quem não é admin (salvo 3 booleanos do próprio chamador e a lista do operador), admin como controle; JWT anterior ao logout sem efeito; fatura e faturado imutáveis pela API. SQL 090 S1–S7: nenhuma DEFINER sem `search_path` ou executável por `anon`. **Corrigidos:** D-CP10-01, `X-Powered-By: Next.js` (M7 RED no build do `d25af37` → GREEN); D-CP10-02, campos da grade do dia sem nome acessível (achado no 1º E2E completo, que falhou com 10 casos da spec 98: 4 por este defeito e 6 em cascata de um clique antes da hidratação; RED reproduzido com a grade preenchida → GREEN). **Risco reproduzido** (SQL 090, 15 casos, mais a prova com o motor ligado): 08:00→07:50 gravado pela `salvar_apontamento_admin` = 1.370 min e R$ 953,13 num dia (pela do operador, R$ 632,50); intervalo > jornada; versão obsoleta; emissão com lançamento e adicional posteriores à conferência; dia aberto e fatura complementar; o mesmo contêiner cobrado 4× (R$ 2.000); RPC legada cria receita; dia depois do fim do contrato cobrado; reabertura de dia faturado; nenhuma função de cancelar fatura. `npm audit`: 12 moderadas (build/dev). Sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check`, Prettier e build PASS; 81/81 `test:*` (`test:seguranca-cp10` 10, novo; `test:interface-cp09` 33); travas 25/25; spec 99 12/12; `npm run e2e:local` 237 testes (236 PASS, 0 FAIL, 1 FALHA CONHECIDA — CN-D —, 0 PULADO, 1533 s, sem rede externa; a 1ª execução completa falhou com 10 casos da spec 98 — D-CP10-02 e o clique antes da hidratação —, corrigidos e repetidos); `sql-local` 53 suítes PASS (090 nova: 25 SEGURO, 15 RISCO REPRODUZIDO); Docker 0 containers e 0 volumes no fim |
| Código e PR afetados | `next.config.ts` (`poweredByHeader: false`); `src/app/(painel)/apontamentos/painel-apontamentos.tsx` e `src/app/(painel)/operacional/painel-operacional.tsx` (`aria-label` por linha); `eslint.config.js` (ignora `e2e-results`); `e2e/apoio/telas.ts` (`abrirDialogoPor`, clique seguro antes da hidratação); `e2e/specs/98-interface-clareza.spec.ts` (AU grade preenchida); `scripts/testar-interface-cp09.mjs` (E3–E4). Testes: `e2e/specs/99-cp10-matriz-api.spec.ts` (novo), `supabase/tests/090_cp10_integridade_e_riscos.sql` (novo; os casos RISCO fixam o comportamento atual e mudam com a migration aprovada), `scripts/testar-seguranca-cp10.mjs` (novo, `test:seguranca-cp10`, também na CI). Docs: `docs/qa/CP-10-seguranca-integridade-infraestrutura.md` (novo), `docs/TESTES_E2E.md`, `PROGRESS.md`, este arquivo. **Nenhuma migration, schema, RPC, RLS, grant, trigger ou regra financeira; nenhum DROP/REVOKE; cobrança por produção não implementada; nenhum dado apagado nem fatura alterada.** PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Docker local (0 containers e 0 volumes antes; 8 imagens preexistentes); Supabase `bs-e2e-cp04` (iteração), `bs-e2e-cp10` (E2E oficial) e `bs-fin11-cp10` (SQL), criados e encerrados pelo próprio `project_id`; `config.toml` restaurado. GitHub (CI). Consulta externa só ao registro npm (`npm audit`). **HML, Preview e Production: nenhum acesso**; nenhuma API de gerenciamento remoto; scripts remotos seguem desativados. O incidente das 4 chamadas vazias (CP-04/CP-05) segue registrado |
| Pendências e decisões | **Bloqueiam o piloto financeiro real (cenário B):** AUT-CP05-01 (P-CP10-01), AUT-CP07-01 (P-CP10-03), DEC-CP06-04 (P-CP10-05), DEC-CP07-03 (P-CP10-06), feriados, publicação; produção se estiver no escopo (DEC-PROD-01/02). **Decisão comercial:** DEC-CP02-01, DEC-CP05-01, DEC-CP07-01/02/03, DEC-CP06-04. **Aceitáveis com controle** (condição, responsável e procedimento no documento): AUT-CP06-01, versão obsoleta, dia aberto, complementar, admin sem MFA. **Não verificados:** Auth real, HSTS, Vercel, proteção de branch, integração Supabase↔GitHub, Preview do #134 → HML. Demonstração fictícia (cenário A): GO condicionado |
| Próxima ação exata | Planejamento GATE-FIN-01/01B (sessões 16–17) e GATE-FIN-02 (sessão 18) |
| Autorizações e proibições | Autorizado e usado: auditoria do código e das migrations, análise de RLS/grants/RPCs, testes locais de segurança, papéis, integridade, concorrência e sessão, análise de infraestrutura por arquivos, correção de defeito de aplicação (D-CP10-01), testes Node/SQL/E2E novos, documentação, propostas de hardening, commit e push só no #134. Proibidos e não feitos: migration, schema, RLS/grants, contratos de RPC, regras financeiras, merge, Ready for review, deploy, rebase, force push, HML, Production, APIs de gerenciamento remoto, SQL remoto, secrets e flags, projetos Supabase, `main` e outros PRs, apagar histórico, alterar faturas, cobrança por produção, CP-11 |

### Tarefa anterior — QA-BS-01 sessão 14, CP-09 (13/11/2026, sessão em nuvem; HEAD `d25af37eafc832ca01e605d7792f33698ba28a52`, `validar`, `sql-local` e `e2e-local` SUCCESS)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 sessão 14 — CP-09, interface, clareza e consistência (13/11/2026, sessão em nuvem), autorizado pelo responsável. Auditoria de todas as telas existentes (painel, acesso e operador) em 390, 768 e 1366 px; D8; R-CP07-06; R-CP08-01 a 03; R-CP08-04 só registrado; clareza de Operações; matriz de gates financeiros com sequência recomendada (não implementada). Detalhe em [docs/qa/CP-09-interface-clareza-consistencia.md](qa/CP-09-interface-clareza-consistencia.md) |
| Resultados e testes comprovados | **RED no `6a23dc4`** (spec 98, 13 falhas em 17): 12 campos com rótulo visível não ligado (Dashboard, Relatórios, Faturamento, adicional, Apontamentos, Operacional), operador sem título enquanto carrega/sem operação, exclusões pelo `window.confirm`, “Alterar condições” de contrato futuro com campos vazios e salvar travado, “Diárias” sem domingo/feriado, margem “0,0%” sem receita, CSV com ponto (LibreOffice pt-BR: ponto = texto, vírgula = número); OP1 (Nova operação sem dizer que cobra por diária) RED no build anterior à correção. Nenhuma rolagem lateral em nenhuma tela e tamanho. **GREEN:** spec 98 18/18; specs 50, 60, 70, 95 e 97 79/79 (CL7 depende da spec 20 e rodou no completo). Sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check` e build PASS; 80/80 `test:*` (`test:interface-cp09` 31, novo); travas 25/25; spec 98 18/18; `npm run e2e:local` 223 testes (222 PASS, 0 FAIL, 1 FALHA CONHECIDA — CN-D —, 0 PULADO, 1577 s, sem rede externa); `sql-local` 52 suítes PASS; Docker 0 containers e 0 volumes no fim |
| Código e PR afetados | `src/app/(painel)/_components/confirmacao-de-exclusao.tsx` (novo, D8) e `src/lib/confirmar-exclusao.ts` (título e descrição); `clientes`, `colaboradores` e `operacoes` (exclusões pelo diálogo); `_components/valor-atual.tsx` (R-CP07-06, `versaoNaData`); `src/lib/apresentacao-indicadores.ts` (novo: diárias de domingo/feriado, percentual da margem, reais no CSV); `dashboard`, `relatorios`, `faturamento` (textos, CSV, rótulos); `faturamento/adicionais.tsx`, `apontamentos`, `operacional` (rótulos; título do operador); `src/lib/container-servico-ui.ts` e `operacoes` (cobrança por diária). Testes: `e2e/specs/98-interface-clareza.spec.ts` (novo), specs 50, 60 e 70 (confirmação pelo diálogo), 95 e 97 (CSV com vírgula), `scripts/testar-interface-cp09.mjs` (novo, `test:interface-cp09`, também na CI), `scripts/testar-colaboradores-custos.mjs` (A4, A5, A5c). Docs: `docs/qa/CP-09-interface-clareza-consistencia.md` (novo), `docs/TESTES_E2E.md`, `PROGRESS.md`, este arquivo. **Nenhuma migration, schema, RPC, RLS, grant, trigger ou fórmula financeira; cobrança por produção, catálogo e painel de Contêineres NÃO criados; nenhum dado apagado.** PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Docker local (0 containers e 0 volumes antes); Supabase `bs-e2e-cp04` (iteração), `bs-e2e-cp09` (E2E oficial) e `bs-fin11-cp09` (SQL), criados e encerrados pelo próprio `project_id`; `config.toml` restaurado. GitHub (CI). **HML, Preview e Production: nenhum acesso nesta sessão**; nenhuma API de gerenciamento remoto; scripts remotos seguem desativados. O incidente das 4 chamadas vazias (CP-04/CP-05) segue registrado |
| Pendências e decisões | **Matriz de gates (CP-09):** bloqueantes para o piloto — feriados em Production e código de Production desatualizado (D5); decisão pendente — cobrança e custos por produção (se o piloto os tiver: DEC-PROD-01/02, DEC-CP06-02/03), contrato encerrado (DEC-CP02-01), cancelamento de fatura (DEC-CP07-03); demais não bloqueiam, com justificativa. **Lacuna:** R-CP08-04 (relatório por cliente e por tipo; DEC-CP06-01). **Riscos:** R-CP09-01 a 03; R-CP07-01 a 05; R-CP05-01 a 03. **Autorizações:** AUT-CP05-01, AUT-CP06-01, AUT-CP07-01. O sistema **não** está financeiramente homologado enquanto essas pendências forem materiais |
| Próxima ação exata | CP-10 (feito na sessão 15) |
| Autorizações e proibições | Autorizado e usado: inspeção, inventário, testes locais e E2E/Node, correção de defeitos de interface comprovados, textos e mensagens, estados, acessibilidade, responsividade, padronização das confirmações, edição sem mudar regra financeira, testes e docs, commit e push só no #134, descrição do PR. Proibidos e não feitos: migrations e schema, funções e contratos de RPC, RLS e grants, regras financeiras, cobrança por produção, catálogo de serviços, painel de Contêineres, remover módulos, apagar histórico, alterar faturas emitidas, funcionalidade não autorizada, redesign, merge, deploy, rebase, force push, HML, Production, APIs de gerenciamento remoto, outros PRs, CP-10 |

### Tarefa anterior — QA-BS-01 sessão 13, modelo de negócio e CP-08 (13/11/2026, sessão em nuvem)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 sessão 13 — consolidação do modelo de negócio e CP-08 (dashboard, relatórios e exportações) (13/11/2026, sessão em nuvem), autorizado pelo responsável. Parte A/B: [NEGOCIO.md §3A](NEGOCIO.md) com o esclarecimento direto do responsável (duração × regime de cobrança × tipo de serviço; diária recorrente ou temporária; produção = quantidade executada × preço unitário; remuneração por produção não esclarecida) e [NEGOCIO_X_SISTEMA.md](NEGOCIO_X_SISTEMA.md) com a matriz de 16 itens (paridade técnica × aderência comercial). Parte C/D: auditoria de `/dashboard`, `/relatorios` e das exportações, com matriz financeira independente. Detalhe em [docs/qa/CP-08-dashboard-relatorios-exportacoes.md](qa/CP-08-dashboard-relatorios-exportacoes.md) |
| Resultados e testes comprovados | **RED no `12f5528`** (spec 97, 8 falhas): Dashboard e Relatórios com custo 1.443,33 (certo 1.513,33) porque o custo do serviço antigo de contêiner contava a EXECUÇÃO e a receita a COMPETÊNCIA (Fechamento e fatura já usavam a competência); gráficos sem dizer que são só apontamentos; período invertido mostrado como falha de leitura; CSV de lançamentos rotulado como exportação geral, sem modalidade e situação; relatório por operação sem Fixa/Avulsa (este por leitura: o teste parava antes, no custo). **Comprovado:** receita 2.502,50, custo 1.513,33, resultado 989,17, margem 39,5%, 8 diárias, 8 faltas, 4 colaboradores, 2,5 h de HE na 1ª quinzena de maio/2027; mesmos totais por cliente no Fechamento e no Faturamento; dia único, 2ª quinzena, mês, sem dados; fatura não muda os totais; operacional, sem papel e anônimo sem `resumo_financeiro_periodo`. **GREEN:** spec 97 12/12; specs 10, 90 e 95 62/62. Sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check` e build PASS; 79/79 `test:*` (`test:custo-containers` 13 na regra nova); travas 25/25; spec 97 12/12; `npm run e2e:local` 205 testes (204 PASS, 0 FAIL, 1 FALHA CONHECIDA — CN-D —, 0 PULADO, 1527 s, sem rede externa); `sql-local` 52 suítes PASS; Docker 0 containers e 0 volumes no fim, 8 imagens preexistentes intocadas |
| Código e PR afetados | `src/lib/custo-containers.ts` e `src/lib/custo-containers-dados.ts` (D-CP08-01: janela de cobrança do adicional, duas consultas paginadas com e sem competência); `src/app/(painel)/dashboard/painel-dashboard.tsx` (rótulos dos gráficos, período invertido); `src/app/(painel)/relatorios/painel-relatorios.tsx` (período invertido, coluna Modalidade, chave por id, CSV como extrato com Modalidade e Faturado, `lancamentos-<início>-<fim>.csv`); `src/app/(painel)/faturamento/painel-faturamento.tsx` (rótulo do CSV). Testes: `e2e/specs/97-dashboard-relatorios-exportacoes.spec.ts` (novo), `e2e/specs/95-fechamento-faturamento.spec.ts` (rótulo), `scripts/testar-custo-containers.mjs` (janela de cobrança; paridade com a fatura do HML sem trocar a data). Docs: `docs/NEGOCIO.md`, `docs/NEGOCIO_X_SISTEMA.md`, `docs/qa/CP-08-dashboard-relatorios-exportacoes.md` (novo), `docs/TESTES_E2E.md`, `PROGRESS.md`, este arquivo. **Nenhum cálculo, SQL, migration, RLS, grant, trigger ou contrato de RPC; cobrança por produção e catálogo NÃO implementados.** PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Docker iniciado (0 containers e 0 volumes antes; 8 imagens preexistentes intocadas); Supabase `bs-e2e-cp04` (iteração), `bs-e2e-cp08` (E2E oficial) e `bs-fin11-cp08` (SQL), criados e encerrados pelo próprio `project_id`. GitHub (CI). **HML, Preview e Production: nenhum acesso nesta sessão**; nenhuma API de gerenciamento remoto; scripts remotos seguem desativados. O incidente das 4 chamadas vazias (CP-04/CP-05) segue registrado |
| Pendências e decisões | **Negócio:** DEC-CP06-01 (catálogo de tipos), DEC-CP06-02 (regimes diária/produção), DEC-CP06-03 (custo por serviço), **DEC-PROD-01** (remuneração por produção), **DEC-PROD-02** (unidades, quantidade, parcial), DEC-CP06-04, DEC-CP06-05, **DEC-AV-01**, **DEC-AV-02**; DEC-CP07-01 a 03; DEC-CP02-01 (CN-D). **Autorizações:** AUT-CP05-01, AUT-CP06-01, AUT-CP07-01 e, para a cobrança por produção, migration/RPC/regra financeira (proposta no relatório do CP-08). **Riscos:** R-CP08-01 a 04; R-CP07-01 a 06. O sistema **não** está financeiramente homologado enquanto essas pendências forem materiais |
| Próxima ação exata | CP-09 (feito na sessão 14) |
| Autorizações e proibições | Autorizado e usado: inspeção, documentação de negócio, CP-08 completo, testes locais, correção de defeitos do CP-08, documentação, commit e push só no #134, descrição do PR. Proibidos e não feitos: merge, Ready for review, rebase, force push, `main` e outros PRs, deploy, HML, Production, APIs de gerenciamento remoto, SQL remoto, projetos Supabase remotos, secrets e flags remotos, migrations, contratos de RPC, RLS e grants, fórmulas financeiras, cobrança por produção, catálogo de serviços, painel de Contêineres, recalcular faturados, apagar histórico, reduzir testes, excluir recursos Docker preexistentes, CP-09 |

### Tarefa anterior — Sessão 12, análise das operações avulsas (13/11/2026, sem alteração)

| Campo | Valor |
| --- | --- |
| Tarefa executada | Análise e proposta, sem alteração de código, banco, commit ou push: estrutura de Operações, avulsa por diária, ausência de tipo e de produção; recomendações de catálogo editável e de regimes de cobrança. Consolidada e corrigida na sessão 13 pelo esclarecimento do responsável |
| Resultados e testes comprovados | Leitura do código no `12f5528`; nenhum teste novo |
| Código e PR afetados | Nenhum |
| Ambientes envolvidos | Nenhum (nem Docker) |
| Pendências e decisões | Absorvidas pela sessão 13 |
| Próxima ação exata | Sessão 13 |
| Autorizações e proibições | Só análise; nenhuma implementação |

### Tarefa anterior — QA-BS-01 CP-07 (13/11/2026, sessão em nuvem, sessão 11)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 CP-07 — fechamento e faturamento (13/11/2026, sessão em nuvem, sessão 11), autorizado pelo responsável. Auditoria de `/fechamento` e `/faturamento`, da RPC `gerar_fatura` e das funções de competência (038): cliente → contrato → operação fixa e avulsa → apontamentos → valores e custos → fechamento → competência → fatura → exportação. Inventário, matriz de ações, competências, D4, conciliação, duplicidade, CN-D, emissão, imutabilidade, segurança, exportações e decisões em [docs/qa/CP-07-fechamento-e-faturamento.md](qa/CP-07-fechamento-e-faturamento.md) |
| Resultados e testes comprovados | **RED no `7e8659f`** (spec 95, 10 falhas): confirmação sem dias abertos (D4); aba que perdeu a corrida com R$ 240,00 a faturar; "TypeError: Failed to fetch" cru na emissão; fatura de R$ 480,00 sobre conferência de R$ 240,00 sem aviso; fatura complementar e duplicidade sem aviso na confirmação; CSV `faturamento-2027-01-01-2027-01-15.csv` sem cliente. **Comprovado sem defeito:** competências iguais na tela e no banco (janeiro, fevereiro comum e bissexto, virada de ano, mensal; personalizado e atravessando o mês recusados com 22023; vazio e antes do contrato com P0002); fechamento e fatura ao centavo por cálculo independente (3.217,50 / 1.813,75, 11 lançamentos, 2 adicionais, Σ itens = total); duplo clique e Enter, chamadas simultâneas (1 fatura, 2 P0002); imutabilidade pela API; operacional, sem papel e anônimo sem fatura. **GREEN:** spec 95 16/16 e spec 30 6/6 (D4 convertido). **CI no `d58c2f7`:** `validar` e `sql-local` SUCCESS; `e2e-local` FAIL só no IM1 (192 testes, 190 PASS, 1 FAIL, 1 FALHA CONHECIDA): o teste escolhia o lançamento faturado com `limit 1` sem ordem e, na CI, pegou um com intervalo 0, então o `UPDATE` de teste não mudava nada e o trigger da 011 (que recusa a MUDANÇA) o aceitou sem efeito — defeito do teste, não do produto; corrigido (lançamento com intervalo > 0, determinístico, e o no-op conferido à parte) e spec 95 16/16 de novo. **CI no `cd6b98c`:** `e2e-local` FAIL no CN-C da spec 70 (e CN-E em cascata): defeito REAL D-CP07-07 — "Alterar condições"/"Alterar custo" abria antes de carregar o valor atual e o formulário nascia vazio (campos ocultos inclusive), com o salvar travado; RED no VA1, corrigido em `_components/valor-atual.tsx` (só habilita com as versões lidas), GREEN nas specs 50, 60, 70 e 95. **CI no `12f55289f23ec45a0af1cb9427b4f1c74e3e6661`:** [validar](https://github.com/therunnas/bslogistica/actions/runs/43439447168/job/131932928651), [sql-local](https://github.com/therunnas/bslogistica/actions/runs/43439447168/job/131932928989) e [e2e-local](https://github.com/therunnas/bslogistica/actions/runs/43439447585/job/131932926117) SUCCESS (193 testes, 192 PASS, 0 FAIL, 1 FALHA CONHECIDA, 0 PULADO, 1217 s). Sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check` e build PASS; 79/79 `test:*` (nova `test:faturamento-cp07` 38; `test:interface-simples` 46); travas 25/25; spec 95 17/17; `npm run e2e:local` 193 testes (192 PASS, 0 FAIL, 1 FALHA CONHECIDA — CN-D —, 0 PULADO, 1403 s, sem rede externa); `sql-local` 52 suítes PASS; 0 containers e 0 volumes no fim |
| Código e PR afetados | `src/lib/faturamento-conferencia.ts` (novo: dias da competência, fatura existente, mensagens da emissão, conferido × emitido, presença do CSV); `src/app/(painel)/faturamento/painel-faturamento.tsx` (relê antes de abrir a confirmação; dias, fatura complementar e duplicidade na confirmação; erro relê e explica; aviso de divergência; CSV com cliente e presença); `src/lib/erros-banco.ts` (`ehFalhaDeRede` exportada); `src/app/(painel)/_components/valor-atual.tsx` (D-CP07-07). Testes: `e2e/specs/95-fechamento-faturamento.spec.ts` (novo), `e2e/specs/30-falhas-conhecidas.spec.ts` (D4 corrigido), `scripts/testar-faturamento-cp07.mjs` (novo, + `package.json` e `ci.yml`), `scripts/testar-interface-simples.mjs` (C8 na forma nova), `scripts/testar-colaboradores-custos.mjs` (A5 com a guarda, A5b nova). Docs: `docs/qa/CP-07-fechamento-e-faturamento.md` (novo), `docs/TESTES_E2E.md`, `PROGRESS.md`, este arquivo. **Nenhum cálculo, SQL, migration, RLS, policy, grant, trigger ou contrato de RPC; nenhuma fatura reaberta ou recalculada.** PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Docker iniciado (0 containers e 0 volumes antes; nada preexistente removido); Supabase `bs-e2e-cp04` (iteração), `bs-e2e-cp07` (E2E oficial) e `bs-fin11-cp07` (SQL), criados e encerrados pelo próprio `project_id`. GitHub (CI). **HML, Preview e Production: nenhum acesso nesta sessão**; nenhuma API de gerenciamento remoto; scripts remotos seguem desativados. O incidente das 4 chamadas vazias (CP-04/CP-05) segue registrado |
| Pendências e decisões | **DEC-CP07-01** (dia aberto: avisar, confirmar ou bloquear), **DEC-CP07-02** (fatura complementar na mesma competência), **DEC-CP07-03** (estados e ciclo da fatura: rascunho e emitida sem uso, cancelamento, estorno, detalhe, nota fiscal), **AUT-CP07-01** (total esperado conferido dentro de `gerar_fatura`). Uma fatura com o mesmo serviço como avulsa e registro antigo (ou adicional manual) **ainda pode ser emitida** (DEC-CP06-04). CN-D segue falha conhecida (DEC-CP02-01). Seguem AUT-CP05-01, AUT-CP06-01, DEC-CP06-01 a 05, DEC-CP04-01, DEC-CP05-01 a 05; R-CP07-01 a 05; D5 e D8 (CP-09) |
| Próxima ação exata | CP-08 — dashboard, relatórios e exportações, com nova autorização; não iniciado |
| Autorizações e proibições | Autorizado e usado: inspeção e auditoria de Fechamento e Faturamento, testes locais com dados sintéticos (E2E, Node), RED/GREEN, correção de exibição, mensagens, estados de erro e carregamento, prevenção de comando com dado desatualizado, testes e documentação, commit e push só no #134, descrição do PR. Proibidos e não feitos: merge, Ready for review, rebase, force push, `main` e outros PRs, deploy, HML, Production, APIs de gerenciamento remoto, scripts remotos, outro Supabase remoto, excluir dados reais, migrations, RLS, regra comercial por suposição, recalcular ou reabrir faturas, mudar a política de bloqueio financeiro, módulo de Contêineres, reduzir testes, excluir recursos Docker preexistentes, CP-08 |

### Tarefa anterior — QA-BS-01 CP-06B (13/11/2026, sessão em nuvem, sessão 10)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 CP-06B — remoção do painel independente de Contêineres (13/11/2026, sessão em nuvem, sessão 10), autorizado pelo responsável: "Contêiner não é um módulo independente"; "todo novo serviço de contêiner deve ser cadastrado por Operações → Nova operação → Avulsa"; "o painel Container não é para mais existir". Detalhe, classificação (DEC-CP06-01) e testes A–J em [docs/qa/CP-06-servicos-avulsos.md](qa/CP-06-servicos-avulsos.md#cp-06b--remoção-do-painel-independente-de-contêineres) |
| Resultados e testes comprovados | **RED no `569c301`:** `/containers` abria o painel "Containers"; o Faturamento ligava para `/containers/<id>`; a Avulsa não explicava os tipos; `/operacoes/avulsos-antigos/<id>` não existia. **GREEN:** `/containers`, `/containers/novo`, `/containers/<id>` e `/corrigir` conferem o admin e redirecionam (histórico em Operações, `/operacoes?origem=conteiner` com o aviso, `/operacoes/avulsos-antigos/<id>` e `/corrigir`); 0 links `/containers` na tela e nenhum `"/containers` em `src`; menu com 8 itens, sem Contêineres; registros antigos consultáveis, cancelado e faturado preservados; Faturamento 1.600,00 com aviso → 1.000,00 depois do cancelamento; registro antigo sem operação (R$ 120, custo 50) uma vez; fatura única 1.170,00 / 730,00 / 4 lançamentos; operacional restrito nas rotas antigas e novas. Sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check` PASS; 78/78 `test:*` (`test:container-telas` 68, `test:servicos-avulsos-cp06` 15, `test:papel` 111); build PASS; spec 90 12/12; `npm run e2e:local` 176 testes (174 PASS, 0 FAIL, 2 FALHA CONHECIDA, 0 PULADO, 1119 s, sem rede externa); `sql-local` 52 suítes PASS; travas 25/25. **CI no `7e8659f4ec8314362dfeef66292b8b680307afb5`:** [validar](https://github.com/therunnas/bslogistica/actions/runs/43410182507/job/131834341555), [sql-local](https://github.com/therunnas/bslogistica/actions/runs/43410182507/job/131834342143) e [e2e-local](https://github.com/therunnas/bslogistica/actions/runs/43410182703/job/131834342093) SUCCESS (176 testes, 174 PASS, 0 FAIL, 2 FALHA CONHECIDA, 0 PULADO, 971 s) |
| Código e PR afetados | Rotas: `src/app/(painel)/containers/page.tsx`, `novo/page.tsx`, `[id]/page.tsx`, `[id]/corrigir/page.tsx` (guarda + redirect); novas `operacoes/avulsos-antigos/[id]/page.tsx` e `[id]/corrigir/page.tsx`; nova seção `operacoes/avulsos-antigos.tsx`; `operacoes/page.tsx` e `painel-operacoes.tsx` (aviso de origem, texto do Tipo, seção de histórico); `containers/lista-containers.tsx`, `detalhe-container.tsx`, `correcao-container.tsx`, `formulario-container.tsx` (sem título de painel; links para Operações); `faturamento/adicionais.tsx` (links); rótulos de custo em `faturamento/painel-faturamento.tsx`, `fechamento/_resumo.tsx`, `dashboard/painel-dashboard.tsx` (só texto); `src/lib/container-servico-ui.ts` (caminhos canônicos). Removido: `containers/cadastro-encerrado.tsx` (aviso do CP-06, substituído pelo redirect). Testes: `e2e/specs/90-servicos-avulsos.spec.ts`, `scripts/test-container-telas.mjs`, `scripts/testar-servicos-avulsos-cp06.mjs`, `scripts/testar-papel.mjs`, `scripts/testar-custo-containers.mjs`, `scripts/testar-margem-containers.mjs`. Docs: `docs/qa/CP-06-servicos-avulsos.md`, `docs/TESTES_E2E.md`, `PROGRESS.md`, este arquivo. **Nenhum SQL, migration, RLS, policy, grant, trigger, contrato de RPC ou cálculo; nenhuma tabela ou registro removido.** PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Supabase `bs-e2e-cp04` (iteração), `bs-e2e-cp06b` (E2E oficial) e `bs-fin11-cp06b` (SQL), criados e encerrados pelo próprio `project_id`. GitHub (CI). **HML, Preview e Production: nenhum acesso nesta sessão**; nenhuma API de gerenciamento remoto; scripts remotos seguem desativados. O incidente das 4 chamadas vazias (CP-04/CP-05) segue registrado |
| Pendências e decisões | **DEC-CP06-01**: classificação estruturada do tipo de avulso não implementada (o nome livre não é catálogo); proposta A (coluna com lista fixa), B (catálogo editável) ou C (manter no nome), com impacto, no relatório. **AUT-CP06-01** (a RPC antiga ainda aceita criação pela API) e **AUT-CP05-01**. DEC-CP06-02 a 05 (DEC-CP06-04: duplicidade só avisada, sem bloqueio). Seguem DEC-CP02-01 a 03, DEC-CP04-01, DEC-CP05-01 a 05; R-CP06-01 a 04; D4 (CP-07), D5, D8 (CP-09); CN-D falha conhecida |
| Próxima ação exata | CP-07 — fechamento e faturamento, com nova autorização; não iniciado |
| Autorizações e proibições | Autorizado e usado: corrigir interface, rotas, navegação e links; reorganizar componentes; integrar a consulta histórica em Operações; testes e documentação; commit e push só no #134. Proibidos e não feitos: deletar dados reais ou históricos, excluir tabelas, aplicar migrations, alterar RLS ou contratos de RPC, alterar cálculo financeiro, HML, Production, scripts de gerenciamento remoto, merge, deploy, rebase, force push, `main` e outros PRs, CP-07 |

### Tarefa anterior — QA-BS-01 CP-06 (13/11/2026, sessão em nuvem, sessão 09)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 CP-06 — serviços avulsos (13/11/2026, sessão em nuvem, sessão 09), autorizado pelo responsável. Modelo: operação fixa e serviço avulso; contêiner é TIPO de serviço avulso; adicional é valor complementar. Auditoria do fluxo canônico (operação Avulsa, `spot`, decisão do #121), do caminho legado de contêiner (`/containers`, 045–050), dos adicionais e da integração com fechamento, fatura e relatório. Inventário, tipos, D7, participantes, adicionais, integração e decisões em [docs/qa/CP-06-servicos-avulsos.md](qa/CP-06-servicos-avulsos.md) |
| Resultados e testes comprovados | **RED no `f22d7e2`:** `/containers/novo` abria o formulário do caminho legado por URL; o mesmo contêiner (operação avulsa R$ 600 + registro antigo ligado à operação, R$ 600) somou **R$ 1.600,00** no Faturamento e R$ 1.650,00 no Fechamento, sem aviso; duplo clique em "Registrar adicional" gravou uma vez e deixou o diálogo aberto. Fluxo canônico PASS: três tipos (contêiner 300/diária × 2; etiquetagem 220; limpeza 180), sem contrato, pedido e execução no mesmo dia, custos 160/200/150/170. **GREEN:** cadastro legado encerrado (tela e servidor), aviso de cobrança em dobro, cancelamento do registro antigo volta o total a R$ 1.000,00, adicional único (R$ 50) e cancelamento com motivo, fechamento 1.050,00 / 680,00, fatura única 1.050,00 / 680,00 / 4 lançamentos, relatório por colaborador, operacional sem acesso. Sessão em nuvem: lint, `tsc`, `check:workflow`, `git diff --check` PASS; 78/78 `test:*` (nova `test:servicos-avulsos-cp06` 12/12; `test:container-telas` 65/65 na nova forma); build PASS; travas 25/25; `npm run e2e:local`: 173 testes (171 PASS, 0 FAIL, 2 FALHA CONHECIDA, 0 PULADO, 1198 s, sem rede externa) e, depois do AD2, spec 90 completo 10/10; `sql-local` 52 suítes PASS. **CI no `569c301b6709a199f8fd5b74d9bf697e46bffeea`:** [validar](https://github.com/therunnas/bslogistica/actions/runs/43342693109/job/131614567191), [sql-local](https://github.com/therunnas/bslogistica/actions/runs/43342693109/job/131614567518) e [e2e-local](https://github.com/therunnas/bslogistica/actions/runs/43342692974/job/131614567203) SUCCESS (174 testes, 172 PASS, 0 FAIL, 2 FALHA CONHECIDA, 0 PULADO, 1176 s) |
| Código e PR afetados | Correções: `src/lib/container-servico-ui.ts` (aviso de duplicidade e recusa do cadastro), `src/app/(painel)/containers/_acoes.ts` (servidor recusa o cadastro novo), `containers/novo/page.tsx` e `containers/cadastro-encerrado.tsx` (novo), `containers/lista-containers.tsx`, `faturamento/adicionais.tsx` (aviso, rótulos, trava do diálogo) e `faturamento/painel-faturamento.tsx`. Testes: `e2e/specs/90-servicos-avulsos.spec.ts` (novo), `scripts/testar-servicos-avulsos-cp06.mjs` (novo, + `package.json` e `ci.yml`), `scripts/test-container-telas.mjs` (rota nova encerrada e stub da trava). Docs: `docs/TESTES_E2E.md`, `docs/qa/CP-06-servicos-avulsos.md`, `PROGRESS.md`, este arquivo. **Nenhum SQL, migration, RLS, policy, grant, trigger ou cálculo; nenhuma tabela, registro ou rota de consulta removida.** PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Docker reiniciado (pids velhos do restart); antes dos testes, conferido que os scripts executáveis só apontam para `127.0.0.1`; Supabase `bs-e2e-cp04` (iteração), `bs-e2e-cp06final` (E2E oficial) e `bs-fin11-cp06` (SQL) criados e encerrados pelo próprio `project_id`; 0 containers e 0 volumes no fim. GitHub (CI). **HML, Preview e Production: nenhum acesso nesta sessão**; nenhuma API de gerenciamento remoto chamada. O incidente das 4 chamadas vazias (CP-04/CP-05) segue registrado |
| Pendências e decisões | **AUT-CP06-01** (encerrar `registrar_servico_container` no banco: migration) e **AUT-CP05-01** (risco financeiro pendente). DEC-CP06-01 (catálogo de tipos de avulso), DEC-CP06-02 (unidade, quantidade e valor fechado, C5), DEC-CP06-03 (custo do participante por serviço, C4), DEC-CP06-04 (duplicidade: avisar ou bloquear), DEC-CP06-05 (participante em dois avulsos sem mover a alocação). Seguem DEC-CP02-01 a 03, DEC-CP04-01 e DEC-CP05-01 a 05. Riscos R-CP06-01 a 04. D4 (CP-07), D5 e D8 (CP-09) abertos; CN-D segue falha conhecida |
| Próxima ação exata | CP-07 — fechamento e faturamento, com nova autorização; não iniciado |
| Autorizações e proibições | Autorizado e usado: inspeção do CP-06, auditoria dos fluxos de avulsos, testes locais com dados sintéticos, E2E e Node, correção de defeitos comprovados (persistência, interface, envio duplicado, validação, caminhos legados), compatibilidade com registros antigos, testes e documentação, commit e push só no #134, descrição do PR. Proibidos e não feitos: merge, Ready for review, rebase, force push, `main` e outros PRs, deploy, HML, Production, APIs de gerenciamento remoto, scripts antigos de SQL remoto, migrations remotas, secrets e flags remotos, outro Supabase remoto, excluir dados reais, regras comerciais por suposição, cálculo financeiro, RLS, estruturas duplicadas de contêiner, apagar funcionalidades ou históricos, desativar testes, excluir recursos Docker preexistentes (não havia), CP-07 |

### Tarefa anterior — QA-BS-01 CP-05 (12/11/2026, sessão em nuvem, sessão 08)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 CP-05 — apontamentos e regras financeiras (12/11/2026, sessão em nuvem, sessão 08), autorizado pelo responsável. Auditoria de `/apontamentos` e `/operacional` (presença, falta, substituição, jornadas, virada de dia, salvar o dia, edição, concorrência) e da regra financeira (dia útil, sábado, domingo, feriado, tolerância, arredondamento, HE cobrada × paga, custo × receita), conferida por cálculo independente contra prévia, banco, fechamento e relatório. D1 corrigido. Inventário, matrizes, D6, decisões e incidente em [docs/qa/CP-05-apontamentos-e-regras-financeiras.md](qa/CP-05-apontamentos-e-regras-financeiras.md) |
| Resultados e testes comprovados | **RED no `75c9b6d`:** D1 gravado sem aviso; nenhuma marca de linha não gravada; segunda aba sobrescreveu a primeira (Bia: presente 18:00 → falta). Toda a matriz financeira PASS de primeira contra o cálculo independente: dia útil 8 h, saída antecipada proporcional, tolerância 10/11, HE nos limites 14/15/16/44/45/46/70, HE paga pelo valor acordado, sábado 3/4/6/8 h, domingo e feriado em dobro, viradas sáb→dom, dom→seg, fim de mês e de ano; 1ª quinzena de novembro: receita R$ 12.172,50 e custo R$ 7.775,51, iguais no fechamento e no relatório. D6: sem defeito na configuração atual (a regra 030 só roda com o dobro desligado). **GREEN, sessão em nuvem:** lint, `tsc`, `check:workflow`, `git diff --check` PASS; 77/77 `test:*` (nova `test:apontamentos-cp05` 24/24); build PASS; travas 25/25; `npm run e2e:local`: 163 testes (161 PASS, 0 FAIL, 2 FALHA CONHECIDA, 0 PULADO, 1142 s, sem rede externa) e, depois do FD1, spec 80 completo 15/15 (D1 saiu das falhas conhecidas); `sql-local` 52 suítes PASS. **CI no HEAD `f22d7e26ab36d74f81a17220617c88366503feb4`:** `validar`, `sql-local` e `e2e-local` SUCCESS (164 testes, 162 PASS, 0 FAIL, 2 FALHA CONHECIDA, 0 PULADO, 1017 s; totais da 1ª quinzena 12.172,50 / 7.775,51) |
| Código e PR afetados | Correções: `src/lib/horarios.ts` (regra do D1), `src/lib/apontamentos-salvar.ts` (conflito de versão), `src/lib/types.ts` (`updated_at`), `src/app/(painel)/apontamentos/painel-apontamentos.tsx` e `src/app/(painel)/operacional/painel-operacional.tsx`. Testes: `e2e/specs/80-apontamentos-financeiro.spec.ts` (novo), D1 em `30-falhas-conhecidas` convertido em PASS, `e2e/apoio/telas.ts` (HE acordada no cadastro), `scripts/testar-apontamentos-cp05.mjs` (novo, + `package.json` e `ci.yml`), H6 de `testar-apontamentos-salvar` na nova forma. Docs: `docs/TESTES_E2E.md`, `docs/qa/CP-05-…`, `PROGRESS.md`, este arquivo. **Nenhum SQL, migration, RLS, policy, grant, trigger ou cálculo.** PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Docker reiniciado (o restart do container deixou `docker.pid` e `containerd.pid` de processos que não existiam); Supabase `bs-e2e-cp04` (iteração), `bs-e2e-cp05final` (E2E oficial) e `bs-fin11-cp05` (SQL) criados e encerrados pelo próprio `project_id`; 0 containers e 0 volumes no fim. GitHub (CI). Preview e Production: nenhum acesso. **HML: 2 chamadas vazias por engano nesta sessão** (e 2 no CP-04): `q.sh` de sessão anterior, que envia SQL à API de gerenciamento do HML, foi chamado com o SQL no lugar do modo, e o corpo foi `{"query": "\n"}` — nada executado, lido ou gravado. Scripts remotos desativados (`*.REMOTO-NAO-EXECUTAR`) |
| Pendências e decisões | **AUT-CP05-01** (trava do D1 e conferência de versão no banco: migration nas duas RPCs, plano no documento do CP-05). DEC-CP05-01 (limite de jornada em turno noturno e registro da confirmação), DEC-CP05-02 (substituto fora da equipe), DEC-CP05-03 (linha nova nasce presente), DEC-CP05-04 (jornada que cruza tipos de dia), DEC-CP05-05 (presença sem horário = diária inteira). Seguem DEC-CP02-01 a 03 e DEC-CP04-01. Riscos: R-CP05-01 a 04. D4 (CP-07), D5, D7 (CP-06) e D8 (CP-09) abertos; CN-D segue falha conhecida |
| Próxima ação exata | CP-06 — serviços avulsos, adicionais e containers, com nova autorização; não iniciado |
| Autorizações e proibições | Autorizado e usado: auditoria de código, UI e banco local; navegador com Supabase local descartável; dados sintéticos; E2E, SQL e regressões; correção dos defeitos comprovados nos apontamentos; validação e proteção contra duplicidade/concorrência; commit e push só no #134; PROGRESS, HANDOFF e documentação de QA. Proibidos e não feitos: merge, Ready for review, rebase, force push, `main` e outros PRs, deploy, Production, migrations remotas, flags e secrets remotos, outro Supabase remoto, excluir dados reais, mudar regra financeira por suposição, decisões comerciais, afrouxar RLS ou permissões, alterar histórico faturado, ocultar falhas conhecidas, remover testes, excluir recursos Docker preexistentes (não havia), CP-06 e CP-07. **Violado sem efeito em dados:** acesso ao HML (chamadas vazias, ver Ambientes) |

### Tarefa anterior — QA-BS-01 CP-04 (12/11/2026, sessão em nuvem, sessão 07)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 CP-04 — operações, turnos e equipes (12/11/2026, sessão em nuvem, sessão 07), autorizado pelo responsável. Auditoria da tela `/operacoes` (operação fixa e avulsa, turnos, equipe), dos valores exibidos e da passagem para apontamento, fechamento e relatório. D3 em turno corrigido. Inventário, matrizes de turnos e equipes, conciliação e decisões em [docs/qa/CP-04-operacoes-turnos-equipes.md](qa/CP-04-operacoes-turnos-equipes.md) |
| Resultados e testes comprovados | **RED no `1f94d03`:** 2 operações e (no `30-falhas-conhecidas`) 2 turnos no duplo clique; nome gravado com espaços; rótulos soltos; cartão da avulsa com o valor do cadastro com erro de leitura; "Salvar turno" sem carregamento. **GREEN, sessão em nuvem:** lint, `tsc`, `check:workflow`, `git diff --check` PASS; 76/76 `test:*` (nova `test:operacoes-turnos` 23/23); build PASS; travas 25/25; `npm run e2e:local`: **148 testes, 145 PASS, 0 FAIL, 3 FALHA CONHECIDA, 0 PULADO**, 990 s (D3 em turno saiu das falhas conhecidas); `sql-local` 52 suítes. **CI no `e57f379`:** `validar` e `sql-local` SUCCESS, `e2e-local` FAIL em 1 teste (OP5: o aviso de recusa anterior ainda era o primeiro quando o teste leu o da exclusão seguinte); corrigido no teste (OP5 e CB6 esperam o aviso específico), 60+70 revalidados localmente (32/32) e na CI do HEAD seguinte. O commit dessa correção (`a9444b9`) levou por engano o `project_id` local (`bs-e2e-cp04`) no `supabase/config.toml`; revertido no commit seguinte, sem force push (o arquivo voltou a ser igual ao da `main`). **CI no `acd1747`:** `validar` e `sql-local` SUCCESS, `e2e-local` FAIL no CL3 do CP-02 (Enter repetido em "Salvar cliente" criou 2 clientes). Defeito real, não do teste (**D-CP04-09**, P2): a trava era liberada no `onSettled` e o diálogo, ainda fechando, aceitava o envio. RED determinístico no novo E2E D3b (10 clientes, 11 colaboradores, 14 operações e turnos); corrigido com `useTravaDoDialogo` (só o erro e a reabertura soltam a trava); GREEN: E2E completo 149 testes (146 PASS, 0 FAIL, 3 FALHA CONHECIDA, 0 PULADO, 919 s; CL3 e D3b PASS), 76/76 `test:*` (`test:operacoes-turnos` 26/26). Conciliação: contrato 250 → 300 e custo 150 → 170 pela data, dois profissionais, turno noturno com data da entrada, fechamento R$ 2.450,00 × R$ 1.490,00, relatório Rui 620 / Sol 720 / Tito 150 |
| Código e PR afetados | Correções: `src/app/(painel)/operacoes/painel-operacoes.tsx` e `operacoes/_dominio.ts` (novo); D-CP04-09 em `src/lib/trava.ts` (`useTravaDoDialogo`), `clientes/painel-clientes.tsx`, `colaboradores/painel-colaboradores.tsx` e `_components/valor-atual.tsx`. Testes: `e2e/specs/70-operacoes-turnos-equipes.spec.ts` (com o D3b), asserções da trava em `testar-clientes-contratos` e `testar-colaboradores-custos`, D3 em turno em `30-falhas-conhecidas` convertido em PASS, `scripts/testar-operacoes-turnos.mjs` (+ `package.json` e `ci.yml`). Docs: `docs/TESTES_E2E.md`, `docs/qa/CP-04-…`, `PROGRESS.md`, este arquivo. **Nenhum SQL, migration, RLS, policy, grant, trigger ou cálculo.** PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Docker iniciado nesta sessão (vazio no início; o `dockerd` só subiu depois de apagar o `/var/run/docker/containerd/containerd.pid` deixado pela sessão anterior, arquivo de execução do próprio daemon); Supabase `bs-e2e-cp04` (iteração e execuções oficiais) e `bs-fin11-cp04` (SQL) criados e encerrados pelo próprio `project_id`; 0 containers e 0 volumes no fim. GitHub (CI). Preview e Production: nenhum acesso. **HML: 2 chamadas vazias por engano** (`{"query": "\n"}` à API de gerenciamento, sem SQL executado), registradas no CP-05 |
| Pendências e decisões | DEC-CP02-01 (contrato encerrado continua cobrando; alternativas a–d no documento do CP-04; reforçado por evidência nova), DEC-CP02-02, DEC-CP02-03, **DEC-CP04-01** (turno de 24 h com início = fim: aceito com aviso). Dependências: CP-05 (salvar o dia grava a equipe inteira; D1), CP-06 (avulsa sem data nasce com vigência de hoje; modalidades), CP-09 (`window.confirm`). Operação não tem status editável (inativar operação não existe). Em Usuários a trava segue liberada no `onSettled` (convite zera o formulário ao fechar; ações de papel idempotentes), registrado no documento do CP-04. D1, D4–D8 abertos |
| Próxima ação exata | CP-05 — apontamentos e regras financeiras, com nova autorização; não iniciado |
| Autorizações e proibições | Autorizado e usado: inspeção, testes em Supabase local, cenários E2E, correção de defeitos do CP-04 (validação, usabilidade, persistência, duplo clique em turnos e operações, carregamento e erro dos valores exibidos), integração com colaboradores, clientes, contratos e apontamentos, documentação, commit e push só no #134, descrição do PR. Proibidos e não feitos: merge, Ready for review, `main` e outros PRs, deploy, Production, migrations remotas, flags e secrets remotos, outro Supabase remoto, excluir dados reais, motor financeiro, decisões de negócio, D1, D4, afrouxar RLS, enfraquecer testes, remover recursos Docker preexistentes (não havia), CP-05. **Violado sem efeito em dados:** acesso ao HML (2 chamadas vazias, ver CP-05) |

### Tarefa anterior — QA-BS-01 CP-03 (12/11/2026, sessão em nuvem, sessão 06)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 CP-03 — colaboradores e valores (12/11/2026, sessão em nuvem, sessão 06), autorizado pelo responsável. Auditoria da tela `/colaboradores` (cadastro, catálogo de funções, "Alterar custo", histórico, valores de hoje) com navegador real e Supabase local, e da passagem do custo para equipe, apontamento, fechamento e relatório. D2 corrigido. Inventário, cenários de vigência e reconciliação em [docs/qa/CP-03-colaboradores-e-valores.md](qa/CP-03-colaboradores-e-valores.md) |
| Resultados e testes comprovados | **RED no `b8f08f7`:** D2 (199 → 150 ao trocar a data); 2 colaboradores no duplo clique; R$ 150,00 do cadastro na lista com erro de leitura e com 300 colaboradores (`.in(...)` > 8 KB → **414**, medido: 200 IDs passam, 300 não); nome com espaços; "Status" solto; e, intermitente na execução completa, o diálogo de "Alterar" aberto depois de duplo clique com o valor já gravado. Bloco F da paginação com a função anterior: "URI Too Long". **GREEN, sessão em nuvem:** lint, `tsc`, `check:workflow`, `git diff --check` PASS; 75/75 `test:*` (nova `test:colaboradores-custos` 17/17; `test:vigencias-paginacao` 31/31); build PASS; travas 25/25; `npm run e2e:local`: **132 testes, 128 PASS, 0 FAIL, 4 FALHA CONHECIDA, 0 PULADO**, 880 s (D2 saiu das falhas conhecidas); `sql-local` 52 suítes. Reconciliação ao centavo: custos 150 → 250 → 270 pela data, hora extra pelo custo vigente (312,50), retroativo recusado, fechamento custo R$ 1.312,50 × receita R$ 1.593,75, relatório Zeca R$ 1.132,50 e Lia R$ 180,00 |
| Código e PR afetados | Correções: `src/app/(painel)/_components/valor-atual.tsx` (D2 e envio único; vale para os três "Alterar"), `src/lib/vigencias-ui.ts` (`manterDigitados`), `src/lib/vigencias-dados.ts` (custos em lotes de 100), `src/app/(painel)/colaboradores/painel-colaboradores.tsx` e `colaboradores/_dominio.ts` (novo). Testes: `e2e/specs/60-colaboradores-custos.spec.ts`, D2 em `30-falhas-conhecidas` convertido em PASS, `scripts/testar-colaboradores-custos.mjs` (+ `package.json` e `ci.yml`), bloco F em `scripts/testar-vigencias-paginacao.mjs`. Docs: `docs/TESTES_E2E.md`, `docs/qa/CP-03-…`, `PROGRESS.md`, este arquivo. **Nenhum SQL, migration, RLS, policy, grant, trigger ou regra de custo.** PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Docker local reiniciado nesta sessão (vazio no início); Supabase `bs-e2e-cp03` (iteração e execuções oficiais) e `bs-fin11-cp03` (SQL) criados e encerrados pelo próprio `project_id`; 0 containers e 0 volumes no fim. GitHub (CI). HML, Preview e Production: nenhum acesso |
| Pendências e decisões | Do CP-02, sem mudança: DEC-CP02-01 (fim do contrato não limita a cobrança), DEC-CP02-02 (exclusão de cliente em cascata), DEC-CP02-03 (`01/01/0001` do HML). Dependências: CP-04 (Operações ainda usa o valor de hoje sem estado; função de trabalho de quem já está alocado muda na equipe), CP-05 (salvar o dia grava a equipe inteira), CP-09 (`window.confirm`). D5 (Production sem o #132) só se resolve com publicação autorizada. D1, D3 em turno, D4, D6–D8 abertos |
| Próxima ação exata | CP-04 — operações, turnos e equipes, com nova autorização; não iniciado |
| Autorizações e proibições | Autorizado e usado: inspeção do CP-03, testes locais isolados, dados sintéticos, correção de defeitos do módulo e do D2, testes novos, correção da consulta de vigências de colaboradores sem mudar semântica financeira, documentação, commit e push só no #134, descrição do PR. Proibidos e não feitos: merge, Ready for review, `main` e outros PRs, deploy, HML, Production, migrations remotas, flags e secrets remotos, outro Supabase remoto, excluir dados reais, regras financeiras, D1, D3 em turno, D4, decisões do CP-02, afrouxar RLS ou autorização, remover testes, remover containers ou volumes preexistentes (não havia), CP-04 |

### Tarefa anterior — QA-BS-01 CP-02 (12/11/2026, sessão em nuvem, sessão 05)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 CP-02 — clientes e contratos (12/11/2026, sessão em nuvem, sessão 05), autorizado pelo responsável. Auditoria da tela `/clientes` (cliente, contrato, condições por vigência, exclusões, feriados) com navegador real e Supabase local, e da passagem dos dados para operação, apontamento e fechamento. D3 em cliente corrigido (turno segue no CP-04). Inventário, matriz de valores e vigências, decisões e evidências em [docs/qa/CP-02-clientes-e-contratos.md](qa/CP-02-clientes-e-contratos.md) |
| Resultados e testes comprovados | **RED no `5a578cb`:** 2 clientes e 2 contratos no duplo clique; contrato gravado com fim antes do início e ano 0001; lista de contratos com R$ 250,00 (cadastro) no lugar de R$ 320,00 (hoje) quando a leitura das vigências falha; exclusão de cliente com apontamentos não faturados confirmada só por "Excluir o cliente X?"; nome com espaços gravado; "TypeError: Failed to fetch"; 14 rótulos soltos; botão sem carregamento. **GREEN, sessão em nuvem:** lint, `tsc`, `check:workflow`, `git diff --check` PASS; 74/74 `test:*` (nova `test:clientes-contratos` 32/32); build PASS (placeholders da CI); travas 25/25; `npm run e2e:local`: **116 testes, 111 PASS, 0 FAIL, 5 FALHA CONHECIDA, 0 PULADO**, 713 s (D3 em cliente saiu das falhas conhecidas; entrou CN-D, DEC-CP02-01); `sql-local` 52 suítes. Integração conferida ao centavo: vigências 250 → 300 → 320 aplicadas pela data e congeladas, alteração retroativa sobre dia lançado recusada pelo banco, fechamento R$ 2.340,00, nome novo do cliente propagado |
| Código e PR afetados | Correções: `src/app/(painel)/clientes/painel-clientes.tsx`, `clientes/_dominio.ts` (novo), `src/lib/trava.ts` (novo; `usuarios/_trava.ts` reexporta), `src/lib/vigencias-dados.ts` (`useValoresDeHojeComEstado`; `useValoresDeHoje` inalterado para os outros módulos), `src/lib/erros-banco.ts` (falha de rede), `src/lib/mutations.ts` (exclusão com a mesma tradução do salvar), `src/lib/confirmar-exclusao.ts` (consequências). Testes: `e2e/specs/50-clientes-contratos.spec.ts`, D3 em `30-falhas-conhecidas` convertido em PASS, `scripts/testar-clientes-contratos.mjs` (+ `package.json` e passo no `ci.yml`). Docs: `docs/TESTES_E2E.md`, `docs/qa/CP-02-…`, `PROGRESS.md`, este arquivo. **Nenhum SQL, migration, RLS, policy, grant, trigger ou regra financeira.** PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Docker local (vazio no início); Supabase `bs-e2e-cp02` (iteração e execução oficial) e `bs-fin11-cp02` (SQL) criados e encerrados pelo próprio `project_id`; 0 containers e 0 volumes no fim. GitHub (CI). HML, Preview e Production: nenhum acesso; o registro `01/01/0001` do HML não foi lido |
| Pendências e decisões | **DEC-CP02-01:** o fim do contrato (e o status Inativo) não limita a cobrança — decidir se encerra, avisa ou é informativo (mexe no motor, CP-05/CP-07). **DEC-CP02-02:** excluir cliente sem histórico faturado apaga em cascata apontamentos não faturados (regra documentada; a tela agora avisa) — decidir se passa a bloquear. **DEC-CP02-03:** saneamento do `01/01/0001` do HML (exige autorização). Dependências: CP-04 (formulário de operação oferece cliente/contrato inativo ou encerrado), CP-05 (salvar o dia grava a equipe inteira), CP-03 (`.in(...)` de colaborador; a forma com estado já existe), CP-09 (`window.confirm`). D1, D2, D4–D8 e D3 em turno abertos |
| Próxima ação exata | CP-03 — colaboradores e valores, com nova autorização; não iniciado |
| Autorizações e proibições | Autorizado e usado: inspecionar clientes e contratos, testes locais isolados, E2E e integração, corrigir defeitos do CP-02 (mensagens, validações, usabilidade, duplo clique, persistência e listas), documentação, commit e push só no #134, descrição do PR. Proibidos e não feitos: merge, Ready for review, `main` e outros PRs, deploy, HML, Production, migrations remotas, flags e secrets remotos, outro Supabase remoto, excluir dados reais, alterar regras financeiras, RLS ou contrato de banco, mexer em cálculo de apontamento ou faturamento, ocultar falhas conhecidas, eliminar testes, remover containers ou volumes preexistentes (não havia), CP-03 |

### Tarefa anterior — QA-BS-01 CP-01 (12/11/2026, sessão em nuvem, sessão 04)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 CP-01 — autenticação e permissões (12/11/2026, sessão em nuvem, sessão 04), autorizado pelo responsável. Auditoria completa com navegador real e Supabase local: login, recuperação de senha (e-mail capturado no Mailpit local), MFA/TOTP real (código calculado do segredo da tela e verificado pelo GoTrue local), administração de usuários e matriz ADMIN × OPERACIONAL × SEM PAPEL × NÃO AUTENTICADO × REVOGADO em tela, API Route, Server Action reenviada, PostgREST e RPC. Infra: `scripts/e2e-local.sh` sobe o Auth com TOTP e cadastro desligado **só por variáveis do processo** (sem `[auth]` no `config.toml`) e o Mailpit; quatro contas sintéticas a mais. Inventário, matriz e evidências em [docs/qa/CP-01-autenticacao-e-permissoes.md](qa/CP-01-autenticacao-e-permissoes.md) |
| Resultados e testes comprovados | **RED no código do `1b2ee20`:** login com "Invalid login credentials" e "User is banned"; TOTP errado com "Invalid TOTP code entered"; duplo clique em "Enviar convite" = 2 e-mails e 2 `convite_criado`, em "Atribuir" = 2 `operacao_atribuida`; duplo clique em "Continuar" da recuperação levou a "link inválido"; convite duplicado com "A user with this email address has already been registered"; lixeira e engrenagem sem nome acessível. **GREEN, sessão em nuvem (Linux, Node 22.23, Docker local):** lint PASS; `tsc` PASS; `check:workflow` PASS; `git diff --check` PASS; 73/73 `test:*` PASS (77 s; nova `test:mensagens-auth` 27/27); build PASS (placeholders da CI); travas 25/25; `npm run e2e:local` completo: **98 testes, 93 PASS, 0 FAIL, 5 FALHA CONHECIDA (as mesmas), 0 PULADO**, 543 s, nenhuma rede externa, encerramento sem sobras; `sql-local` 52 suítes PASS, 82 s. Não testados (motivo no documento do CP-01): expiração natural do JWT, renovação isolada pelo `proxy.ts`, link expirado por tempo |
| Código e PR afetados | Correções: `src/lib/mensagens-de-login.ts` (novo), `src/app/login/page.tsx`, `src/app/mfa/painel-mfa.tsx`, `src/app/(painel)/configuracoes/painel-configuracoes.tsx`, `src/app/(painel)/usuarios/_trava.ts` (novo), `painel-usuarios.tsx`, `gerenciar-usuario.tsx`, `src/lib/admin-usuarios/servico.ts`, `src/app/auth/confirmar-recuperacao/botao-confirmar.tsx` (novo) e `page.tsx`. Testes: `e2e/specs/40-autenticacao.spec.ts`, `41-permissoes.spec.ts`, `e2e/apoio/{totp,email,contas}.ts`, `scripts/testar-mensagens-auth.mjs` (+ `package.json` e passo no `ci.yml`). Infra/docs: `scripts/e2e-local.sh`, `e2e/sql/semente-local.sql`, `docs/TESTES_E2E.md`, `docs/qa/CP-01-…`, `PROGRESS.md`, este arquivo. **Nenhum SQL, migration, RLS, policy, grant, trigger ou regra financeira.** PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Docker local (vazio no início); Supabase `bs-e2e-cp01` (iteração e execução oficial) e `bs-fin11-cp01` (SQL) criados e encerrados pelo próprio `project_id`; 0 containers e 0 volumes no fim. E-mails só para `@exemplo.test`, capturados localmente. GitHub (CI). HML, Preview e Production: nenhum acesso |
| Pendências e decisões | (1) Decisão do responsável: o GoTrue responde `user_banned` antes de conferir a senha, então pela API do Auth (fora do app) é possível saber que um e-mail pertence a conta revogada; a tela já não revela. (2) Mensagens do SDK que continuam visíveis por decisão documentada (falha do `unenroll`, falha de leitura de fatores no `/mfa`): rever no CP-09. (3) Confirmar no Preview o domínio do redirecionamento de `/auth/confirm` (no `next start` local sai `localhost`). (4) D1–D8 abertos nos CPs previstos; I1 sem execução nativa no macOS |
| Próxima ação exata | CP-02 — clientes e contratos, com nova autorização; não iniciado |
| Autorizações e proibições | Autorizado e usado: inspecionar código e docs, testes locais em Supabase descartável, contas e dados sintéticos locais, TOTP real local, e-mail no capturador local, corrigir defeitos do CP-01 com RED/GREEN, testes de regressão, PROGRESS/HANDOFF/descrição do PR, commit e push só no #134. Proibidos e não feitos: merge, Ready for review, `main` e outros PRs, HML, Production, deploy, migrations remotas, configurações e secrets remotos, outro Supabase remoto, convites para e-mails reais, regras financeiras, excluir dados reais, remover containers ou volumes preexistentes (não havia), afrouxar RLS/MFA/guards, MFA obrigatório, D1–D8, desativar testes, CP-02 |

### Tarefa anterior — QA-BS-01 CP-00B (12/11/2026, sessão em nuvem, sessão 03)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01 CP-00B (12/11/2026, sessão em nuvem, sessão 03), autorizado pelo responsável: consolidar a baseline executável no HEAD `fdda696` e investigar I1. I1 corrigido de forma portável em `scripts/e2e-local.sh`: o app sobe num grupo de processos próprio pelo controle de tarefas do bash (`set -m`, existente no bash do Linux e no bash 3.2 do macOS), sem `setsid`; o script confere que o app é líder do próprio grupo e interrompe se não for; o encerramento derruba o grupo (e o líder, como recuo). Regressão em `e2e/guarda/testar-guardas.mjs` (G22–G25, com `setsid` falso que falha como no macOS). `docs/TESTES_E2E.md` atualizado (25 travas, portabilidade, variável de ambiente com domínio proibido) |
| Resultados e testes comprovados | **A. CI (Linux) no `fdda696`:** `validar`, `sql-local` e `e2e-local` SUCCESS; 63 testes, 58 PASS, 0 FAIL, 5 FALHA CONHECIDA, 0 PULADO; 21 travas. **B. Sessão em nuvem (Linux, Node 22.23, Docker local), com o diff do CP-00B:** `npm ci`; lint PASS; `tsc` PASS; `check:workflow` PASS; 72/72 `test:*` PASS (83 s + `test:func-ready`); build PASS (placeholders da CI); travas 25/25 PASS; prova de mutação (script com `setsid` falha no G22); `e2e:local` completo: 63 testes, 58 PASS, 0 FAIL, 5 FALHA CONHECIDA, 0 PULADO, 284 s, 47/47 conferências financeiras sem divergência, nenhuma rede externa, encerramento sem sobras; `sql-local` (`scripts/testar-sql-local.sh`): 52 suítes PASS, 84 s. A trava recusou corretamente a variável `CLAUDE_CODE_USER_EMAIL` (domínio proibido) desta sessão: o E2E rodou sem ela, sem afrouxar a trava. **C. macOS:** não executado; a correção é portável por desenho e pelos G22–G25, mas não há execução nativa comprovada |
| Código e PR afetados | `scripts/e2e-local.sh`, `e2e/guarda/testar-guardas.mjs`, `docs/TESTES_E2E.md`, `PROGRESS.md`, `docs/HANDOFF.md`. Nenhum `src/`, regra financeira, RLS, migration ou workflow. PR #134 (Draft) |
| Ambientes envolvidos | Sessão em nuvem: Docker local iniciado nesta sessão (vazio no início; Supabase `bs-e2e-sessao03-1` e `bs-fin11-sessao03-1` criados e encerrados pelo próprio `project_id`; 0 containers e 0 volumes no fim). GitHub (CI). HML, Preview e Production: nenhum acesso |
| Pendências e decisões | I1 sem comprovação nativa no macOS (rodar `npm run e2e:local` no Mac quando houver oportunidade; não bloqueia). D1–D8 abertos, nos CPs previstos. Da integração: `useValoresDeHoje` (recuo silencioso e `.in(...)`), fim de contrato `01/01/0001` no HML, SQL independente e gates de Production. Checkout `fix/auditoria-bs-202610` do Mac: preservar |
| Próxima ação exata | CP-01 — autenticação e permissões, com TOTP real no Supabase local; não iniciar correções de D1–D8 antes do checkpoint correspondente |
| Autorizações e proibições | Autorizado e usado: testes locais isolados na sessão, correção de I1 em `scripts/e2e-local.sh` e nas guardas, docs do checkpoint, commit e push só no #134, descrição do PR. Proibidos e não feitos: merge, Ready for review, `main` e outros PRs, deploy, HML, Production, migrations remotas, flags, secrets, outro Supabase remoto, excluir containers ou volumes preexistentes (não havia), `src/`, regras financeiras, RLS, desligar travas, CP-01 |

### Tarefa anterior — RECONCILIACAO-134 (12/11/2026, #134 com base `main`)

| Campo | Valor |
| --- | --- |
| Tarefa executada | RECONCILIACAO-134 (12/11/2026, sessão em nuvem, QA-BS-01 sessão 02), autorizada pelo responsável: reconciliar o #134 com a `main` depois dos squashes do #132 e do #133, só Git e documentação. HEAD anterior do #134 `76fec3a7a098af08519c0aa12729147bb04589fa`; `main` `f6df1fbf58e8eb34648e2328b926ef99c7ad7164` incorporada por merge (sem rebase nem force push); base do PR trocada de `test/e2e-playwright-local` para `main`. Único conflito: `docs/HANDOFF.md` (Identificação, Última tarefa e título da UX-PENTE-FINO-02), resolvido preservando o checkpoint QA-BS-01 (CP-00, CP-00B, D1–D8, I1, limitações do E2E no macOS) e o registro da INTEGRACAO-132-133. `PROGRESS.md` mesclado sem conflito (QA-BS-01 + seção do E2E da `main`) |
| Resultados e testes comprovados | SHAs de integração conferidos no GitHub: #132 validado `afc2219`, integrado `1c6042e424e1030a0d4280e73e339730ebc87a65`; #133 validado `bded9e1b2605313e6f96b9261bc1b45896037a90` (`validar`, `sql-local`, `e2e-local` SUCCESS; 63 testes: 58 PASS, 0 FAIL, 5 FALHA CONHECIDA, 0 PULADO; 21 travas), integrado `f6df1fbf58e8eb34648e2328b926ef99c7ad7164` (árvore idêntica à do `bded9e1`; CI da `main` SUCCESS). Diff do #134 contra a `main` depois do merge: só `PROGRESS.md` e `docs/HANDOFF.md`. Local: `git diff --check` e `npm run check:workflow` PASS. CI no novo HEAD do #134: ver PR #134 |
| Código e PR afetados | Só `docs/HANDOFF.md` e `PROGRESS.md` (e o commit de merge). Nenhum `src/`, teste, script, migration ou workflow alterado. PR #134: base `main`, descrição atualizada, continua Draft |
| Ambientes envolvidos | GitHub (branch e PR #134, CI). HML, Preview e Production: nenhum acesso; nenhum deploy, banco, flag ou secret |
| Pendências e decisões | Todas as do QA-BS-01 abaixo seguem abertas: D1–D8 e I1 (nenhum corrigido), CP-00B. Da integração: `useValoresDeHoje` (recuo silencioso e `.in(...)` com todos os IDs), fim de contrato `01/01/0001` num registro antigo do HML, SQL independente e demais gates de Production. Checkout `fix/auditoria-bs-202610` do Mac: preservar, não integrar sem decisão |
| Próxima ação exata | CP-00B — finalizar o baseline executável local (E2E local no Mac sem `setsid`, SQL local, 58 PASS / 5 FALHA CONHECIDA); depois CP-01. Não corrigir defeitos antes disso |
| Autorizações e proibições | Autorizado e usado: inspecionar Git e GitHub, merge da `main` na branch do #134, resolver o HANDOFF, atualizar PROGRESS, HANDOFF e a descrição do #134, trocar a base para `main`, commit e push só nesta branch. Proibidos e não feitos: merge do #134, Ready for review, rebase, force push, outras branches ou PRs (#125), deploy, HML, Preview remoto, Production, banco, migrations, flags, secrets, `src/`, correção de D1–D8, CP-00B |

### Tarefa anterior — QA-BS-01, CP-00 e início do CP-00B (12/11/2026, Mac)

| Campo | Valor |
| --- | --- |
| Tarefa executada | QA-BS-01, CP-00 e início do CP-00B (12/11/2026, Claude Code no Mac). CP-00: leitura de CLAUDE/AGENTS/PROGRESS/HANDOFF/ESTADO/WORKFLOW/AMBIENTES/NEGOCIO/NEGOCIO_X_SISTEMA da main; conferência de Git, PRs e CI; inventário de 16 telas do painel, 7 de acesso e 5 rotas de API; leitura da autorização das APIs `/api/fechamento*` e `/api/calendario/municipios` e das Server Actions de usuários, containers e vigências (todas conferem sessão e `admin` no servidor antes do banco); plano CP-00 a CP-12 e defeitos D1–D8 e I1 no [PROGRESS](../PROGRESS.md#qa-bs-01--checkpoints). CP-00B: baseline executável no Mac |
| Resultados e testes comprovados | Mac, Node 24.15, em `5b4f44a`: `npm ci`, `npm run lint` PASS, `npx tsc --noEmit` PASS, 74/74 `test:*`/`check:*` PASS (`test:calendario-runners` falhou só por `docker` fora do PATH e passou 23/23 depois), `npm run build` PASS com os placeholders da CI. `npm run e2e:local`: travas 21/21 PASS, Supabase local `bs-e2e-qa01`, 56 migrations, semente e build OK; **BLOQUEADO** na subida do app (`setsid` não existe no macOS, saída 7); Playwright não rodou. Nenhum teste SQL local rodou nesta sessão. Divergências documentais: PROGRESS dizia main `ecd67f2` e HANDOFF `8c493a5`; o real é `1d60ca0` (corrigido no PROGRESS) |
| Código e PR afetados | Só `PROGRESS.md` e `docs/HANDOFF.md`. Nenhum código, teste, migration ou workflow alterado |
| Ambientes envolvidos | Mac local: Docker Desktop ligado; 36 containers `supabase_*` antigos de 9 instâncias locais removidos com autorização do responsável, **14 volumes preservados** (os 24 containers sem esse prefixo intocados); Supabase local `bs-e2e-qa01` criado e encerrado pelo script. HML, Preview e Production: nenhum acesso |
| Pendências e decisões | I1 (`setsid`) bloqueia o E2E local no Mac. Checkout original `fix/auditoria-bs-202610`: 9 commits de 17/10 nunca publicados, com a migration `019_historico_operacional_desalocado`, `src/lib/apontamentos/rascunho.ts` e `scripts/testar-apontamentos.mjs` ausentes da main — preservar, não integrar sem decisão. Negócio: cidade do piloto (feriados), C1–C6, modalidade dos avulsos |
| Próxima ação exata | Fechar o CP-00B (E2E local: 58 PASS / 5 FALHA CONHECIDA esperados) e iniciar o CP-01; correções na ordem D1/D2 → D3 → demais, cada uma com teste RED → GREEN, `test:*`, E2E e registro aqui |
| Autorizações e proibições | Autorizado pelo responsável (prompt QA-BS-01, 12/11/2026): inspecionar o repositório, testes locais seguros, criar testes, corrigir código nesta branch, commits nela e PR Draft. Proibidos: merge, Ready for review, Production, HML, Preview remoto com banco, migrations remotas, flags, secrets, exclusão de dados, outro projeto Supabase, alterar outras branches ou PRs (#125, #132, #133), commitar `supabase/config.toml` |

### Tarefa anterior — INTEGRACAO-132-133 (12/11/2026, #132 em `1c6042e`, #133 em `f6df1fb`)

| Campo | Valor |
| --- | --- |
| Tarefa executada | INTEGRACAO-132-133 (12/11/2026, sessão em nuvem), autorizada pelo responsável: homologação funcional do #132 aceita no escopo testado (V1 no HML; V2–V5 pelo Codex no Preview `afc2219` → HML, lote `TESTE-AUD-132-FINAL-R2`, com ressalvas). #132 tirado do Draft e integrado por squash: **SHA integrado `1c6042e424e1030a0d4280e73e339730ebc87a65`** (árvore idêntica à do `afc2219` validado). #133: base trocada para `main` e `main` incorporada por merge, sem force push; único conflito em `docs/HANDOFF.md`, resolvido mantendo os registros das duas tarefas |
| Resultados e testes comprovados | #132: `validar` e `sql-local` SUCCESS no `afc2219` (HEAD validado) e CI da `main` no `1c6042e`. #133: SHA validado antes da atualização `5b4f44a` (`validar`, `sql-local`, `e2e-local` SUCCESS; 58 PASS, 5 FALHA CONHECIDA, 0 FAIL, 0 PULADO; 21 travas). O HEAD final do #133 e o SHA do squash do #133 ficam no PR #133 e no relatório da tarefa (o checkpoint não pode citar o próprio commit de integração) |
| Código e PR afetados | #132 (`src/`, teste estrutural, HANDOFF) na `main`. #133: só E2E, Playwright, comandos `e2e:*`, `.gitignore` e documentação; nenhum `src/`, migration ou `ci.yml` |
| Ambientes envolvidos | GitHub (PRs, CI). Sem deploy: `vercel.json` mantém `main: false`. HML e Production: nenhum acesso nesta tarefa; nenhuma alteração de banco |
| Pendências e decisões | Cinco defeitos conhecidos (B3 horário de saída antes da entrada; duplo clique em cliente e turno; valor digitado perdido ao trocar a data no "Alterar custo"; confirmação da fatura sem aviso de dias abertos). `useValoresDeHoje`: recuo silencioso para a coluna do cadastro em erro/carregamento e `.in(...)` com todos os IDs (`src/lib/vigencias-dados.ts:104`, `:372-405`). Fim de contrato `01/01/0001` num registro antigo do HML (não vem do #132). SQL independente e demais gates de Production. **#134** (`fix/qa-bs-01-estabilizacao`, base `test/e2e-playwright-local`, HEAD `76fec3a`): reconciliar a base com a nova `main` depois do squash do #133, sem rebase nem force push |
| Próxima ação exata | Responsável decide a reconciliação do #134: trocar a base para `main` e incorporar a `main` por merge na `fix/qa-bs-01-estabilizacao` (conflitos esperados só onde o squash duplicou histórico: HANDOFF e arquivos do E2E idênticos), revalidar a CI e só então continuar a auditoria CP-00B a CP-12. Próxima tarefa recomendada: corrigir o risco de horários (B3) preservando jornadas noturnas legítimas |
| Autorizações e proibições | Autorizado e usado: tirar Draft e integrar #132 e #133 por squash, trocar a base do #133, merge da `main` na branch do #133, resolver o HANDOFF, atualizar descrições. Não autorizado e não feito: Production, deploy, migrations, configuração, flags, bancos remotos, alterar ou integrar o #134, tocar o #125, excluir branches |

### Tarefa anterior — E2E-REVISAO-02 (12/11/2026, PR #133, integrado em `f6df1fb`)

| Campo | Valor |
| --- | --- |
| Tarefa executada | E2E-REVISAO-02 (12/11/2026, sessão em nuvem), continuação do E2E-IMPLEMENTACAO-01 no PR #133 (Draft): proteção do encerramento de `scripts/e2e-local.sh`. Defeito confirmado no HEAD `3c7915c`: `trap encerrar EXIT` registrado antes das validações e `supabase stop --no-backup` incondicional e sem `--project-id`; `db reset` antes da conferência de identidade; instância preexistente não era recusada. Correção: validações (travas, Docker, `project_id` `bs-e2e-…`, sem vínculo remoto, nenhuma instância do Supabase CLI preexistente, portas 54321–54324 e 3000 livres) antes de qualquer operação destrutiva; posse marcada só no `start` desta execução; identidade (URL local, container rodando, rótulo `com.supabase.cli.project`) conferida ANTES do reset; encerramento só do app, da pasta temporária e de `stop --project-id <projeto> --no-backup` quando a posse existe. Docs dos artefatos corrigidas: traces de falha podem conter cookies e JWT da sessão sintética local |
| Resultados e testes comprovados | `node e2e/guarda/testar-guardas.mjs`: 21/21 PASS local (G14–G21 novos, com stubs de `docker`/`npx`/`npm`/`curl` numa cópia do script: destino inválido, URL externa e vínculo remoto sem start/reset/stop; instância preexistente e porta ocupada recusadas; instância própria + erro no ensaio com reset depois da identidade e único stop `--project-id`; identidade divergente sem reset; nenhum stop sem `--project-id` nem `--all`). Prova de mutação: com o script de `3c7915c`, G14 falha (`stop --no-backup` chamado com destino inválido). Lint PASS; `shellcheck` indisponível nesta sessão. CI no novo HEAD: ver PR #133 |
| Código e PR afetados | `scripts/e2e-local.sh`, `e2e/guarda/testar-guardas.mjs`, `docs/TESTES_E2E.md`, `docs/HANDOFF.md`. PR #133 (Draft), branch `test/e2e-playwright-local` |
| Ambientes envolvidos | Sessão em nuvem (stubs, sem Docker) e GitHub Actions (Supabase local descartável). HML, Production e Preview: nenhum acesso |
| Pendências e decisões | Confirmar no novo HEAD: `validar`, `sql-local` e `e2e-local` (58 PASS e 5 FALHA CONHECIDA preservados). Revisão do responsável |
| Próxima ação exata | Responsável revisa o PR #133 (Draft). Sem merge, Ready for review ou deploy |
| Autorizações e proibições | Autorizado: só os 4 arquivos acima, commit e push na branch do #133. Proibidos e não feitos: `src/`, migrations, cálculos, `ci.yml`, dependências, flags, usuários, PRs #125 e #132, HML, Production, Preview, outro PR, force push, merge, deploy, Ready for review |

### Tarefa anterior — E2E-IMPLEMENTACAO-01 (12/11/2026, PR #133 em Draft)

| Campo | Valor |
| --- | --- |
| Tarefa executada | E2E-IMPLEMENTACAO-01 (12/11/2026, sessão em nuvem), autorizada pelo responsável: testes de ponta a ponta com Playwright contra o app em loopback e um Supabase LOCAL descartável no GitHub Actions (workflow próprio `.github/workflows/e2e.yml`, job `e2e-local`, sem tocar o `ci.yml`). Travas de isolamento em `e2e/guarda/` com testes negativos; semente local com a configuração da Production; contas sintéticas locais com login real pela tela. 63 cenários: fumaça, ciclo completo (cadastros, V1–V5 do #132, fixa ao centavo, avulsa, fechamento, exportações, fatura, painéis), segurança do operador e 5 defeitos conhecidos reproduzidos. Concluída, aguardando revisão do responsável |
| Resultados e testes comprovados | Rodada verde em `74209af` (run 43152825786): `e2e-local` 63 testes — 58 PASS, 0 FAIL, 5 FALHA CONHECIDA, 0 PULADO; servidor sem nenhuma tentativa de rede externa; CI `validar` (lint, `tsc`, 72 suítes `test:*`, build) e `sql-local` SUCCESS no mesmo SHA. Esperado × obtido ao centavo: 12 lançamentos da fixa (250/150; 187,50/112,50; 343,75/187,50; 273,44/154,69; 296,88/164,06; sábado 4 h 250/150 e 6 h 343,75/187,50; domingo e feriado 500/300; noturno 250/150; falta 0/0; substituição 250/150), cliente fixo 3.445,32/2.006,25, fatura com adicional 3.545,32, avulsa 400/300, vigência 750/490, painéis 4.695,32/2.796,25. Ajustes só do teste ao longo das rodadas (seletores, fim exclusivo `[)` da vigência, valor próprio da fixa a partir de hoje, `signOut` global da API, `customWidth` no Excel); nenhum código da aplicação alterado. Travas 13/13 PASS local e na CI |
| Código e PR afetados | `.github/workflows/e2e.yml`, `scripts/e2e-local.sh`, `e2e/**`, `playwright.config.ts`, `package.json`/lockfile (só `@playwright/test` 1.63.0 e os scripts `e2e:local`/`e2e:guardas`), `.gitignore`, docs. PR Draft próprio com base na branch do #132 |
| Ambientes envolvidos | Sessão em nuvem e GitHub Actions (Supabase local descartável). HML e Production: nenhum acesso |
| Pendências e decisões | Defeitos reproduzidos (FALHA CONHECIDA, sem correção nesta tarefa): B3 jornada de 22h50 sem aviso; duplo clique em cliente e turno duplica; "Alterar custo" perde o valor digitado ao trocar a data; confirmação da fatura sem aviso de dias abertos. Texto exato do aviso do V4 só no artefato `e2e-74209af…` (o faturado não mudou). Dependem do Preview: Auth real (MFA/TOTP, e-mail), borda da Vercel, dados e feriados do HML. Revisão do responsável do PR Draft |
| Próxima ação exata | Responsável revisa o PR Draft do E2E (base: branch do #132). Sem merge, Ready for review ou deploy até a revisão |
| Autorizações e proibições | Autorizado e usado: infraestrutura E2E local, branch `test/e2e-playwright-local` e PR Draft próprio. Proibidos e não feitos: acesso ao HML ou à Production, `src/`, migrations, `ci.yml`, merge, Ready for review, deploy, force push, alterar os PRs #125 e #132 |

### Tarefa anterior — UX-PENTE-FINO-02 (11/11/2026, #132 integrado em `1c6042e` em 12/11/2026)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-PENTE-FINO-02 (11/11/2026), achado do responsável no teste: depois de "Alterar custo" (150 → 250 a partir de hoje), a lista de Colaboradores seguia mostrando 150, porque lia a coluna `employees.daily_cost`, que não acompanha a vigência; o apontamento já usava 250 (correto). Novo `useValoresDeHoje` (lê só as tabelas de versões) e as listas passam a mostrar o valor que vale hoje: custo do colaborador (lista, custo médio, equipe da operação), condições do contrato (lista e escolha de contrato na operação) e valor da operação sem contrato (cartão). Textos de origem sem "vigência": "Preço do contrato desde dd/mm/aaaa", "Valor próprio da operação…"; caixa "Preço" sem "diária preço do contrato"; avisos de sucesso em palavras simples. Segundo achado: "Alterar custo" para uma data em que já começa outro valor dava "A vigência informada se sobrepõe…"; agora o "Alterar" corrige esse valor (RPC `corrigir_*`, mesmo período; `montarCorrecao` e `useCorrigirVigencia`) e avisa na janela. Terceiro achado (teste manual): contrato e custo criados com início em 11/11 recusavam apontar 03/11, sem caminho pela tela; agora uma data ANTES do primeiro valor antecipa o início desse valor pela mesma correção (conferido no HML em transação desfeita: contrato, custo e valor da operação; 03/11 passa a gravar 343,75/187,50) e as mensagens de "sem valor para a data" dizem o que fazer |
| Resultados e testes comprovados | Linux, Node 22: lint, `tsc`, 72/72 `test:*` (D2, D3 e E2 atualizados para os textos novos) e build PASS. Sem verificação visual nesta sessão |
| Código e PR afetados | `src/lib/vigencias-dados.ts`, `src/lib/vigencias-ui.ts`, `src/lib/apontamentos-financeiro.ts`, telas de colaboradores, clientes, operações e apontamentos, `scripts/testar-interfaces-vigencia.mjs`, `docs/HANDOFF.md` |
| Ambientes envolvidos | Sessão em nuvem, CI e Preview. Banco, cálculo e Production: nada |
| Pendências e decisões | Teste manual do responsável no Preview (datas de início do contrato e do custo precisam ser anteriores aos dias lançados). Production só com autorização |
| Próxima ação exata | Responsável confere as listas e refaz o teste manual |
| Autorizações e proibições | Autorizado (11/11/2026): pente fino das telas, PR e merge. Proibido sem autorização nominal: Production, banco |

### Tarefa anterior — UX-PENTE-FINO-01 (11/11/2026, #131 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-PENTE-FINO-01 (11/11/2026, sessão em nuvem), lista de 20 itens aprovada pelo responsável ("tudo autorizado"): palavras simples no lugar de "vigência"/"HE"; aviso do motor só fora do estado normal; histórico em lista (sem rolagem lateral) com "Definir data de fim" e "Cancelar registro errado"; confirmação antes de excluir cliente, contrato, operação, turno e colaborador; componente comum `ValorAtualComAlteracao` (valor atual + "Alterar", histórico recolhido) para operação sem contrato, custo do colaborador e condições do contrato; colaborador com uma função só (catálogo, também no cadastro novo); operação Fixa sem campos de avulsa e sem campo de valor quando há contrato; função por alocação, período do turno e "função do dia" escondidos com a resolução por função desligada; contrato sem jornada, jornada de sábado e fator de feriado na tela (campos `ocultoNaTela`, valor atual segue no envio) e "Tarifas" só com a resolução ligada; textos curtos em Apontamentos e Feriados |
| Resultados e testes comprovados | Conferido no código do motor que, com o dobro ligado, jornada, jornada de sábado e fator de feriado do contrato não entram no cálculo (núcleo V2 com divisor 8 e sábado fixo; caminho 030 não é usado). `validarNovaVigencia` aceita os valores do banco ("250.00", "1.50", "8.0"). Linux, Node 22: lint, `tsc`, 72/72 `test:*` (testes estruturais atualizados: G5, G7, G8f, G9b–G9f, funções C2) e build PASS. Sem verificação visual nesta sessão (sem login) |
| Código e PR afetados | `src/app/(painel)/_components/vigencias.tsx`, `_components/valor-atual.tsx` (novo), `operacoes/valor-acordado.tsx`, `operacoes/painel-operacoes.tsx`, `colaboradores/painel-colaboradores.tsx`, `clientes/painel-clientes.tsx`, `clientes/feriados.tsx`, `apontamentos/painel-apontamentos.tsx`, `src/lib/vigencias-ui.ts`, `src/lib/vigencias-dados.ts` (a criação atômica devolve o id), `src/lib/apontamentos-financeiro.ts`, `src/lib/confirmar-exclusao.ts` (novo), três testes estruturais, `docs/HANDOFF.md` |
| Ambientes envolvidos | Sessão em nuvem, CI e Preview (HML). Banco, cálculo, Production: nada |
| Pendências e decisões | Conferência visual e teste manual do responsável no Preview. Production só com autorização. Cidade do piloto e feriados |
| Próxima ação exata | Responsável confere as telas no Preview e refaz o teste manual |
| Autorizações e proibições | Autorizado (11/11/2026): os 20 itens, PR e merge. Proibido sem autorização nominal: publicar em Production, banco |

### Tarefa anterior — HML-LIMPEZA-02 (11/11/2026)

| Campo | Valor |
| --- | --- |
| Tarefa executada | HML-LIMPEZA-02 (11/11/2026, sessão em nuvem), pedido do responsável ("limpe primeiro") antes do teste manual: dados sintéticos do HML removidos com `docs/runbooks/limpeza-hml-sintetico.sql` do #125, mudando só a assinatura da verificação 3.1 para a 051 (56, `20261118120000`, `2612ecd5ea3f5cf0c0000aa0d7ae8055`) |
| Resultados e testes comprovados | Backup lógico das 31 tabelas de `public` (JSON + SHA256SUMS) entregue ao responsável. Ensaio a seco 36/36; ensaio com expurgo em transação desfeita 36/36 e validação final aprovada (HML intacto depois: 10 clientes, 7 faturas, 56 apontamentos). Execução: EXECUTADO, 36/36, validação integral aprovada. Depois: 0 clientes/colaboradores/operações/apontamentos/faturas/feriados; 17 contas, 15 papéis, 4 funções-padrão, 7 trilhas `sistema`; motor ligado; `dias_especiais_em_dobro=true`; RLS em todas; 1 gatilho desabilitado (o do motor antigo, como antes). Dobro em transação desfeita: 7/7 |
| Código e PR afetados | Só documentação, no #130 (`docs/HANDOFF.md`, `docs/ESTADO_DO_PROJETO.md`, `PROGRESS.md`). O script adaptado não foi versionado: o #125 segue com a assinatura da 050 |
| Ambientes envolvidos | HML (limpeza). Production e Vercel: nada |
| Pendências e decisões | Teste manual do responsável no HML (passo a passo enviado no chat). Cidade do cliente-piloto e feriados. #125: fechar ou atualizar para a 051 |
| Próxima ação exata | Aguardar o resultado do teste manual do responsável |
| Autorizações e proibições | Autorizado (11/11/2026): limpeza do HML. Proibido sem autorização nominal: escritas em Production |

### Tarefa anterior — PROD-051-01 (11/11/2026)

| Campo | Valor |
| --- | --- |
| Tarefa executada | PROD-051-01 (11/11/2026, sessão em nuvem), autorizado pelo responsável ("se for exatamente como está nos planos ... sim"): o [roteiro](runbooks/dias-especiais-em-dobro.md) executado em Production — conferência, 051 pelo `aplicar-migration-api.py`, suíte 051 com o interruptor desligado, interruptor ligado por transação guardada (motivo em `pricing_settings.reason`), conferência com ele ligado — e site publicado pela API da Vercel com a `main` `ecd67f2` |
| Resultados e testes comprovados | Script: conferência OK e aplicação PASS (56 migrations, versão `20261118120000`, nenhuma tabela com menos linhas, RLS em todas, motor e tarifas iguais). Suíte 051 em transação desfeita: 26/26. Ligado, em transação desfeita: domingo 8 h 500/300, segunda 250/150, feriado 500/300, domingo sem contrato 400/300. Depois: 1 cliente, 3 contas, 0 apontamentos, 0 feriados, 0 tabelas sem RLS. Vercel: `dpl_2zSqLHxW42m693VWr9m4QeFPQWqb` READY, `admin.bslogisticas.com.br` apontando para ele |
| Código e PR afetados | Só documentação, no #130: `docs/HANDOFF.md`, `docs/AMBIENTES.md`, `docs/ESTADO_DO_PROJETO.md`, `PROGRESS.md` |
| Ambientes envolvidos | Production: banco (051 + interruptor) e site. HML: já feito na tarefa anterior. Reversão do site: `dpl_d5xJB7s7CULxQXbFg94FVS9sJj1C`; da regra: desligar o interruptor |
| Pendências e decisões | Cidade do cliente-piloto. Feriados vazios em HML e Production. Teste manual do responsável (TESTE-MANUAL) depois dos feriados. Órfãos de `profiles`/`user_roles`, matriz E2E, `npm audit`, #125 |
| Próxima ação exata | Pedir a cidade do piloto e cadastrar os feriados (HML e Production) |
| Autorizações e proibições | Autorizado (11/11/2026): o roteiro da 051 em Production e a publicação do site. Proibido sem autorização nominal: desligar o interruptor, ligar a resolução comercial, outras escritas em Production |

### Tarefa anterior — HML-051-01 (11/11/2026)

| Campo | Valor |
| --- | --- |
| Tarefa executada | HML-051-01 (11/11/2026, sessão em nuvem): merge do #129 pedido pelo responsável ("pode mesclar por mim"), em `ecd67f2` depois da CI verde; com a autorização do responsável para o HML com dados fictícios, aplicação da 051 no HML pelo `aplicar-migration-api.py` e interruptor `dias_especiais_em_dobro` ligado por transação guardada (motivo registrado em `pricing_settings.reason`) |
| Resultados e testes comprovados | Script: PASS (56 migrations, versão `20261118120000`, nenhuma tabela com menos linhas, RLS em todas, motor igual, tarifas iguais com a coluna nova desligada). Suíte 051 no HML com o interruptor desligado, em transação desfeita: 26/26. Interruptor ligado, conferência em transação desfeita: domingo 8 h 500/300 `domingo`, segunda 250/150, feriado 500/300, domingo sem contrato (200) 400/300; resolução comercial OFF. Nenhum dado fictício ficou gravado (0 clientes `C51-%`) |
| Código e PR afetados | Só documentação: `docs/HANDOFF.md`, `docs/AMBIENTES.md`, `docs/ESTADO_DO_PROJETO.md`, `PROGRESS.md` |
| Ambientes envolvidos | HML: 051 aplicada e interruptor ligado. Production: nada nesta tarefa. Vercel: nada |
| Pendências e decisões | Cidade do cliente-piloto para os feriados municipais. Lista de feriados vazia em HML e Production (cadastrar antes dos apontamentos). Production: 051 e interruptor esperam "autorizo Production" |
| Próxima ação exata | Com "autorizo Production": aplicar a 051, ligar o interruptor e publicar o site, pelo roteiro |
| Autorizações e proibições | Autorizado (11/11/2026): merge do #129, HML com dados fictícios. Proibido sem autorização nominal: Production (migration, interruptor, site) |

### Tarefa anterior — FUNC-READY-02 (11/11/2026, #129 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | FUNC-READY-02 (11/11/2026, sessão em nuvem), decisão do responsável: domingo e feriado pagam as horas efetivas em dobro (horas + 100%) na cobrança e no pagamento, com interruptor desligado por padrão. Migration `20261118120000_051_domingo_feriado_em_dobro.sql`: coluna `pricing_settings.dias_especiais_em_dobro` (false), função interna `dias_especiais_em_dobro_ativo()` (interruptor E motor ligado, sem grant), `derivar_valores_por_vigencia` passa domingo e feriado da lista legada ao ramo especial do núcleo V2 com o interruptor ligado mesmo com a resolução OFF (trava R3 só com resolução e dobro desligados), `estado_motor_vigencia` anuncia `dias_especiais_em_dobro`. Prévia: `interpretarDiasEspeciaisV2` aceita o anúncio (a tela diz que o banco calcula ao salvar). Ligar/desligar: escrita direta como `postgres` em transação autorizada, sem RPC nova |
| Resultados e testes comprovados | HML, migration + `supabase/tests/051_domingo_feriado_em_dobro.sql` numa transação desfeita (11/11/2026): 26/26 PASS — desligado igual à 050 (domingo 250/150 `util`, feriado 250/300); `authenticated` não altera nem executa (42501); ligado: domingo 8 h 500/300, segunda e sábado sem mudança, domingo-feriado conta uma vez (500/300 `feriado`), valor acordado 200 → 400/300, 4 h 250/150, 10 h 625/375, linha gravada antes não muda sozinha, edição motriz recalcula, só notas preserva; desligado de novo: R3 recusa (55000) e domingo novo volta à 030. Depois: HML sem a coluna e sem a função, motor md5 `967058d6…` (igual a antes). Linux, Node 22: 72/72 `test:*` (inventários de migration atualizados como na 050; `035_nucleo_financeiro_puro.sql` regerado pelo gerador: só o md5 do motor), lint, `tsc` e build PASS. `sql-local` só na CI |
| Código e PR afetados | `supabase/migrations/20261118120000_051_domingo_feriado_em_dobro.sql` e `supabase/tests/051_domingo_feriado_em_dobro.sql` (novos), `supabase/tests/035_nucleo_financeiro_puro.sql` (regerado), `src/lib/vigencias-ui.ts`, `src/integrations/supabase/types.ts`, `scripts/testar-dias-especiais.mjs`, testes de inventário (`testar-configuracoes`, `-interfaces-vigencia`, `-motor-vigencia`, `-regras-definitivas`, `-nucleo-isolamento`), `docs/runbooks/dias-especiais-em-dobro.md` (novo), `docs/runbooks/README.md`, `PROGRESS.md`, `docs/HANDOFF.md`. PR Draft da branch `claude/jolly-allen-fqechw` |
| Ambientes envolvidos | Sessão em nuvem e CI. HML: só transação desfeita, sem escrita permanente. Production: nada nesta tarefa (antes dela, com "pode publicar" do responsável, o site foi publicado com o #128) |
| Pendências e decisões | Cidade do cliente-piloto para os feriados municipais: sem resposta. Lista de feriados legada vazia em HML e Production: cadastrar ANTES dos apontamentos (o tipo do dia fica congelado no lançamento). Domingo/feriado com o interruptor ligado exige custo vigente do colaborador (sem ele, P0002, como com a resolução ON). `holiday_pay_factor` do contrato deixa de valer com o interruptor ligado (o dobro é fixo) |
| Próxima ação exata | Conferir CI do PR; merge pelo responsável; aplicar a 051 no HML e ligar o interruptor só com autorização nominal, pelo roteiro |
| Autorizações e proibições | Autorizado pelo responsável (11/11/2026): a correção com interruptor desligado por padrão, PR Draft e teste em transação desfeita no HML. Proibidos sem autorização nominal: aplicar a 051 ou ligar o interruptor em HML ou Production, merge |

### Tarefa anterior — UX-OPERACAO-01 (11/11/2026, #128 mesclado e publicado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-OPERACAO-01 (11/11/2026, sessão em nuvem), pedido do responsável por uma tela de operação mais simples. (A) `LocalidadeDaOperacao` não aparece com o regime de calendário "legado" (resolução comercial OFF), em que o cálculo ignora a localidade; com regime territorial ou desconhecido, nada muda. (B) Novo `ValorAcordadoDaOperacao` (`src/app/(painel)/operacoes/valor-acordado.tsx`): valor vigente hoje, "Alterar valor" que pede só o novo valor e a data e grava pela mesma `useRegistrarVigencia("operacao")` (motivo "Alteração do valor acordado pela tela da operação", versão anterior encerrada no dia anterior, mesma validação `validarNovaVigencia`), e o histórico completo recolhido em "Ver histórico". Em operação existente com o motor por vigência, o campo de valor travado e vazio deixa de aparecer; em operação nova o campo continua |
| Resultados e testes comprovados | RED → GREEN: `test:calendario-territorial` (asserções da localidade com regime legado; o primeiro GREEN falhou por um comentário com o mesmo texto do aviso e a asserção passou a procurar o elemento da tela) e `test:interfaces-vigencia` (G9 atualizado para o componente novo; G9b–G9f novos; 162/0). Linux, Node 22.23: 72/72 `test:*`, `npm run lint`, `npx tsc --noEmit`, `npm run build` e `git diff --check` PASS. Não houve verificação visual nesta sessão (sem login) |
| Código e PR afetados | `src/app/(painel)/_components/calendario-territorial.tsx`, `src/app/(painel)/operacoes/painel-operacoes.tsx`, `src/app/(painel)/operacoes/valor-acordado.tsx` (novo), `scripts/test-calendario-territorial.mjs`, `scripts/testar-interfaces-vigencia.mjs`, `docs/HANDOFF.md`. PR Draft da branch `claude/jolly-allen-fqechw` |
| Ambientes envolvidos | Sessão em nuvem e CI. Nenhum banco, migration, cálculo, faturamento, HML ou Production tocado |
| Pendências e decisões | Bloqueio do piloto (domingo/feriado com resolução OFF): aprovado pelo responsável fazer com interruptor desligado por padrão (próxima tarefa). Cidade do cliente-piloto para os feriados municipais: sem resposta. Publicar o site com esta mudança depois do merge |
| Próxima ação exata | Conferir CI do HEAD do PR; revisão e conferência visual pelo responsável; nenhuma promoção a Ready ou merge sem autorização |
| Autorizações e proibições | Autorizado pelo responsável (11/11/2026): simplificar a tela de operação (A e B) e PR Draft. Proibidos: banco, cálculo, faturamento, Production, merge sem autorização |

### Tarefa anterior — PROD-050-01 (11/11/2026, #127 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | PROD-050-01 (11/11/2026, sessão em nuvem): plano `docs/runbooks/producao-034-050.md` e script `docs/runbooks/aplicar-migration-api.py`; **janela executada com autorização do responsável**: 035–050 aplicadas em Production e site publicado com a `main` `d33e8b2` |
| Resultados e testes comprovados | Leituras de 11/11/2026: Production com 39 migrations (034), faltando exatamente 035–050, sem versão estranha; nenhum dado de negócio (1 cliente de teste "te"); 3 contas e 7 `profiles`/7 `user_roles` órfãos; RLS em todas as tabelas; motor ligado desde 29/10; Auth com modelo de recuperação correto e convite com `{{ .ConfirmationURL }}`; Vercel: Preview → HML e Production → Production comprovados pela primeira vez (leitura dos valores públicos de `NEXT_PUBLIC_SUPABASE_URL`); site em `dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4`/`38b4349`. HML: 55 migrations, md5 `01ca9136…` igual ao esperado pelo #125. Script, só conferência: Production 035 aceita; HML 050 recusada (já aplicada e não posterior); `--executar` sem `BS_CONFIRMO_PROJETO` recusado; o primeiro teste pegou leitura de `pricing_settings` inexistente na 034, parou com STOP e foi corrigido. Backup de Production feito pelo responsável (`pg_dump -Fc`, 1.510 itens) com segunda cópia. A senha do banco de Production apareceu no chat e foi trocada pelo responsável antes do backup |
| Código e PR afetados | `docs/runbooks/producao-034-050.md`, `docs/runbooks/aplicar-migration-api.py`, `docs/runbooks/README.md`, `docs/HANDOFF.md`. PR Draft desta branch contra main |
| Ambientes envolvidos | Production: 16 migrations aplicadas (14:04–14:10 UTC), conferidas uma a uma e no fim (RLS, flags, CHECK, ACL, gatilhos, dados preservados). Vercel: deployment de Production criado pela API (`dpl_ASYPuBYeqaaJZikv5mcdsDsToSbg`, READY, domínio trocado). HML somente leitura. Nenhuma configuração de Auth alterada. A execução rodou sem pedido de confirmação na tela (modo "Accept edits"), dentro da autorização dada no chat |
| Pendências e decisões | Bloqueio do piloto: domingo/feriado com resolução OFF (ver `PROGRESS.md`); decisões pedidas: regra de 100% na cobrança e no pagamento, resolução ON ou migration 051, cidade do piloto. Interface A e B propostas. Depois: limpar órfãos de `profiles`/`user_roles`, matriz E2E antes de contas operacionais reais |
| Próxima ação exata | Pedir "autorizo Production" e executar a seção 4 do plano, parando na primeira falha |
| Autorizações e proibições | Autorizado (11/11/2026): acesso a Supabase e Vercel, preparação do plano e PR Draft. Escrita em Production só depois do "autorizo Production" explícito na janela. Proibidos: merge sem autorização, force push, `config push`, alterar configuração de Auth |

### Tarefa anterior — UX-FATURA-02 (11/11/2026, #126 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-FATURA-02 (11/11/2026, sessão em nuvem): na tela Apontamentos, a linha faturada mostra o rótulo "Faturado"; o cabeçalho "Equipe do dia" mostra "N de M faturados"; com todas as linhas do dia faturadas aparece "Todos os lançamentos deste dia já foram faturados e não podem ser alterados." e "Salvar" fica indisponível. "Fechar dia"/"Reabrir" inalterado: é só status da folha e não altera lançamento faturado. Usa o conjunto `faturados` que já travava os campos; nenhuma consulta nova |
| Resultados e testes comprovados | RED → GREEN em `scripts/testar-interface-simples.mjs` (E1–E6: 5 falharam antes; E6, que guarda "Fechar dia", já passava; 46/0 depois). `scripts/testar-apontamentos-salvar.mjs` D8 passou a contar `faturados.has(row.employeeId)` só dentro de `disabled=` (o rótulo também consulta o conjunto); continua 4 e cai para 3 se um campo perder o bloqueio (conferido com cópia mutada). Linux, Node 22.23: 72/72 `test:*` PASS, `npm run lint`, `npx tsc --noEmit`, `npm run build` (placeholders públicos) e `git diff --check` PASS |
| Código e PR afetados | `src/app/(painel)/apontamentos/painel-apontamentos.tsx`, `scripts/testar-interface-simples.mjs`, `scripts/testar-apontamentos-salvar.mjs`, `docs/HANDOFF.md`. PR Draft da branch `claude/jolly-allen-fqechw` contra main |
| Ambientes envolvidos | Sessão em nuvem e CI. Nenhum banco, HML, Production, cálculo, faturamento, migration, dependência, workflow, `vercel.json` ou `.env` tocado. A tela não foi aberta no navegador (sem login nesta sessão) |
| Pendências e decisões | Conferência visual da tela pelo usuário (localhost → HML, só olhar). #125: ensaio do script de limpeza BLOQUEADO por falta de Docker/Supabase CLI/backup 050; diagnóstico do Mac pendente. Leitura do HML pela nuvem indisponível: o token do Supabase retornou "Invalid access token" em 11/11/2026. O Windows local recebeu WSL numa sessão anterior (não registrado antes). Prévia de HE em `src/lib/billing.ts` (`<= 15`/`<= 45`) não foi alterada: o banco ainda usa a regra 030 em domingo/feriado com resolução OFF, e a prévia da tela vem de `previa-v2`; tratar só em tarefa própria |
| Próxima ação exata | Conferir CI do HEAD do PR; revisão do usuário; nenhuma promoção a Ready ou merge sem autorização nominal |
| Autorizações e proibições | Autorizados pelo usuário (11/11/2026, "faça o que for mais correto e seguro"): código e testes desta tela, commit/push na branch da sessão e um PR Draft. Proibidos: banco, migrations, cálculo, faturamento, `billing.ts`, HML, Production, `.env`, merge, Ready, force push |

### Tarefa anterior — DOC-01 (10/11/2026, #124 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | DOC-01 (10/11/2026): alinhar `PROGRESS.md` ao estado real depois de #119–#123. Reescritas as seções "Tarefa ativa única", "Situação", "Próxima etapa" e "Não fazer ainda", e a linha "Dependências" de "Marcos concluídos"; incluída a fila acordada com o responsável. Histórico preservado |
| Resultados e testes comprovados | Fatos conferidos por leitura: `git log origin/main` (`6fd2632` #119, `f3f846e` #120, `0db831f` #121, `7b03772` #122, `c6f9130` #123; `cad9f51` é o #117, mesclado; #118 fechado sem merge); 55 migrations, a última `20261117120000_050`; API do GitHub: 0 PRs abertos; `origin/docs/hml-limpeza-runbook` existe (`169f592`). HML 050 e flags pelo registro verificado de 09/11/2026 (não reconsultado: sem consulta ao banco nesta tarefa). `npm audit --json` (somente leitura) sobre o lockfile: 12 moderadas, 0 altas, 0 críticas, em `glob`/`minimatch` via `typescript-eslint` e `@sentry/*`. Validação: `check:workflow` PASS (inclusive `--base c6f9130 --head` do commit), links locais pelo validador, Prettier de `PROGRESS.md` PASS, `git diff --check` PASS. O HANDOFF já não passava no Prettier antes desta tarefa; não foi reformatado inteiro (fora do escopo) |
| Código e PR afetados | Apenas `PROGRESS.md` e `docs/HANDOFF.md`. PR Draft desta branch contra main |
| Ambientes envolvidos | Local (worktree, `npm ci` sem alterar `package.json`/lockfile) e CI. Nenhum código, script, dependência, banco, migration, workflow, `vercel.json`, `.env`, HML ou Production tocado |
| Pendências e decisões | Fila: (2) auditoria do código e roteiro de limpeza do HML para a 050; (3) limpar o HML e teste manual do zero; (4) ajustes do teste manual, incluindo UX-FATURA-02; (5) Production `pg_dump` + 035–050 com autorização nominal; (6) piloto. Decisões de negócio: tipos de serviço avulso, modalidade de cobrança, pagamento por pessoa ou rateio; Dynamis (intervalo do dia útil, saída antecipada, sábados acima de 4h); C1–C6. Dívida técnica: as 12 moderadas do `npm audit`, PR próprio depois do piloto, nunca `npm audit fix --force` |
| Próxima ação exata | Conferir CI do HEAD do PR; revisão do usuário; nenhuma promoção a Ready ou merge sem autorização nominal |
| Autorizações e proibições | Autorizados: worktree/branch, edição de `PROGRESS.md` e `docs/HANDOFF.md`, commit/push desta branch e um PR Draft. Proibidos: código, scripts, banco, migrations, dependências (`npm audit fix`, `npm update`, `package.json`/lockfile), workflows, `vercel.json`, `.env`, HML, Production, merge, Ready, force push, outro PR |

### Tarefa anterior — UX-FATURA-01 (10/11/2026, #123 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-FATURA-01 (10/11/2026): na tela Faturamento, "Gerar fatura" deixa de emitir na hora e abre um `AlertDialog` de confirmação com cliente, período, quantidade de apontamentos e de adicionais incluídos, total a faturar (dados que a tela já tinha, sem consulta nova) e o aviso "A fatura emitida não pode ser alterada nem apagada." Botões "Cancelar" (foco inicial) e "Emitir fatura"; só "Emitir fatura" chama `generate.mutate()` |
| Resultados e testes comprovados | RED → GREEN em `scripts/testar-interface-simples.mjs` (C8–C15: 8 falharam antes, 40/0 depois). Em andamento, os dois botões ficam desabilitados e o diálogo não fecha (`onOpenChange` ignora com `generate.isPending`); dupla emissão bloqueada por `emitindoRef` antes do `mutate` e `event.preventDefault()` na ação; diálogo fecha em `onSettled`. Windows, Node 26.13, sobre `7b03772` + diff: `npm run lint`, `npx tsc --noEmit`, `check:workflow`, `check:vercel-deployments`, `npm run build` e `git diff --check` PASS; 69/72 `test:*`, as 3 de ambiente com contagens idênticas (`calendario-runners` 10/13, `workflow` 7/1, `vercel-deployments` 0/22). Navegador (app do worktree em `localhost:3001`, CSP → `qbnfcm…`, admin, só leitura): HOMOLOG-SINT-AV2, 01–15/11, total R$ 150,00 → "Gerar fatura" abriu "Emitir fatura?" com Cliente HOMOLOG-SINT-AV2, Período 01/11/2026 a 15/11/2026, Apontamentos 1, Adicionais 0, Total a faturar R$ 150,00, o aviso e foco em Cancelar; cancelado: diálogo fechado, 7 faturas antes e depois (também após recarregar), nenhuma do HOMOLOG-SINT-AV2, total a faturar segue R$ 150,00 |
| Código e PR afetados | `src/app/(painel)/faturamento/painel-faturamento.tsx`, `scripts/testar-interface-simples.mjs`, `docs/HANDOFF.md`. PR Draft desta branch contra main |
| Ambientes envolvidos | Local (worktree, `npm ci`, `next dev` na 3001 lendo o `.env` existente sem alterá-lo, encerrado) e CI. HML só lido: nenhuma escrita, nenhuma fatura emitida. Production, banco, RPC `gerar_fatura`, cálculo, `billing.ts`, `.env` intocados. `AGENTS.md` reescrito pelo `next dev`: restaurado, fora do commit. Prints no scratchpad da sessão (`ux-fatura/prints`) |
| Pendências e decisões | UX-FATURA-02: apontamento faturado sem rótulo "Faturado", folha "Aberto" e "Salvar"/"Fechar dia" habilitados. Observação: em tela estreita o rodapé do diálogo empilha "Emitir fatura" acima de "Cancelar" (padrão do componente); o foco inicial continua em Cancelar. Atritos anteriores e decisões de negócio dos avulsos seguem abertos |
| Próxima ação exata | Conferir CI do HEAD do PR; revisão do usuário; nenhuma promoção a Ready ou merge sem autorização nominal |
| Autorizações e proibições | Autorizados: worktree/branch, `npm ci`, `painel-faturamento.tsx` e o teste estrutural, navegador só para olhar e cancelar, commit/push desta branch e um PR Draft; Preview automático (não é homologação). Proibidos: banco, migrations, RLS, grants, flags, cálculo, faturamento (RPC e regras), `billing.ts`, auth/MFA, `vercel.json`, workflows, `.env`, chave de serviço, escrita no HML, emitir fatura, Production, rótulo "Faturado" (UX-FATURA-02), merge, Ready, force push, outro PR |

### Tarefa anterior — UX-AVULSA-03 (10/11/2026, #122 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-AVULSA-03 (10/11/2026): na tela Nova operação, com motor por vigência ligado e contrato escolhido, o campo "Valor acordado por diária (avulsa)" passa a ficar desabilitado e vazio, `agreed_amount` não vai no payload e aparece "O valor vem do contrato. Para um valor próprio deste serviço, deixe o contrato em branco." Sem contrato, segue a vigência inicial ("Cadastro inicial da operação"); edição de operação existente inalterada |
| Resultados e testes comprovados | RED → GREEN em `scripts/testar-interfaces-vigencia.mjs` (G8b–G8g: 5 falharam antes, 157/0 depois; G8 e `testar-valores-operacao` E1 preservados, 146/0). Windows, Node 26.13, sobre `0db831f` + diff: `npm run lint`, `npx tsc --noEmit`, `check:workflow`, `check:vercel-deployments`, `npm run build` e `git diff --check` PASS; 69/72 `test:*` PASS, as 3 de ambiente com contagens idênticas (`calendario-runners` 10/13, `workflow` 7/1, `vercel-deployments` 0/22). Navegador (app do worktree em `localhost:3001`, CSP → `qbnfcm…`, admin): (a) PASS na tela — R$ 150 digitado e contrato `HOMOLOG-SINT-AV Contrato` escolhido: campo limpo e desabilitado com a ajuda; salvar NÃO executado (criaria operação além da autorizada; salvar com contrato sem valor já provado na HML-AVULSO-01), formulário cancelado. (b) PASS — `Contagem de palete - HOMOLOG-SINT-AV2`, avulsa sem contrato, R$ 150,00, 10/11/2026: cartão "Valor acordado R$ 150,00", histórico com vigência 10/11/2026 em aberto, "Informada · Cadastro inicial da operação". (c) PASS — `HOMOLOG-SINT-AV2 Colaborador 1` sem turno, 08:00–17:00/60 min = 8h00 R$ 150,00 (diária de referência R$ 150,00, "Vigência do valor acordado"), custo R$ 100,00, conferido após recarregar. (d) PASS — Fechamento 01–15/11 HOMOLOG-SINT-AV2: receita R$ 150,00, custo R$ 100,00, resultado R$ 50,00 (33,3%), conciliação "Confere" nas 6 parcelas |
| Código e PR afetados | `src/app/(painel)/operacoes/painel-operacoes.tsx`, `scripts/testar-interfaces-vigencia.mjs`, `docs/HANDOFF.md`. PR Draft desta branch contra main |
| Ambientes envolvidos | Local (worktree, `npm ci`, `next dev` na 3001 lendo o `.env` existente sem alterá-lo, encerrado) e CI. HML, escrita sintética pelas telas: cliente `HOMOLOG-SINT-AV2`, colaborador `HOMOLOG-SINT-AV2 Colaborador 1` (R$ 100 desde 01/11; criado por decisão do usuário porque os dois `HOMOLOG-SINT-AV` estavam alocados e 0 disponíveis), operação `Contagem de palete - HOMOLOG-SINT-AV2` com vigência inicial, alocação sem turno, 1 apontamento de 10/11. Nenhuma fatura; nenhum registro existente, conta, papel, Configurações, Implantação de vigências ou flag alterado. `AGENTS.md` reescrito pelo `next dev`: restaurado, fora do commit. Prints no scratchpad da sessão (`ux-avulsa-03/prints`) |
| Pendências e decisões | Decisões de negócio dos avulsos: lista de tipos de serviço, unidade e modalidade de cobrança (diária, unidade, valor fechado como adicional), remuneração por pessoa ou rateio. Atritos já registrados (sem turno com horários vazios, "Localidade ausente" que não bloqueia, "Gerar fatura" sem confirmação, faturado sem rótulo) seguem abertos |
| Próxima ação exata | Conferir CI do HEAD do PR; revisão do usuário; nenhuma promoção a Ready ou merge sem autorização nominal |
| Autorizações e proibições | Autorizados: worktree/branch, `npm ci`, formulário de operação e o teste estrutural correspondente, escrita sintética `HOMOLOG-SINT-AV2` descrita acima (sem fatura), commit/push desta branch e um PR Draft; Preview automático (não é homologação). Proibidos: banco, migrations, RLS, grants, flags, cálculo, precedência de preços, faturamento, `billing.ts`, auth/MFA, `vercel.json`, workflows, `.env`, chave de serviço, alterar registros existentes, contas, Configurações, Implantação de vigências, emitir fatura, Production, merge, Ready, force push, outro PR |

### Tarefa anterior — HML-AVULSO-01 e botão escondido (09/11/2026, #121 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | HML-AVULSO-01 (09/11/2026): homologação de telas do cenário 10, fluxo avulso de ponta a ponta, app do worktree `bslogistica-ux-menu` em `c32a93f` (#121) em `localhost:3001` (CSP → `qbnfcm…`), admin `bcviniciuslc@gmail.com` sem MFA, resolução comercial OFF |
| Resultados e testes comprovados | **8 PASS, 1 PARCIAL.** a PASS: cliente `HOMOLOG-SINT-AV` e contrato `HOMOLOG-SINT-AV Contrato` (R$ 200,00, 8h, 1,5x, tolerância 10 min, vigência 01/11/2026). b PASS: `HOMOLOG-SINT-AV Colaborador 1/2`, custo R$ 100/110 desde 01/11. c **PARCIAL**: operação avulsa `Descarga de container – HOMOLOG-SINT-AV` (`622cbc76…`), data 09/11/2026, contrato selecionado; com "Valor acordado por diária (avulsa)" = 200 o salvamento foi recusado ("Com o motor por vigência ligado, taxa, custo ou valor acordado só entram por registro de vigência (data de início e motivo), não por INSERT direto."), nada gravado; salva sem o valor, a diária R$ 200 veio do contrato. d PASS: 2 colaboradores alocados "Sem turno". e PASS: sem turno, 08:00–17:00/60 min = 8h00 R$ 200,00; 08:00–18:30/60 min = 9h30, HE 1h30 R$ 56,25 (200 ÷ 8 = 25,00 × fator 1,5 = 37,50 × 1,5 h = 56,25), total R$ 256,25; custo R$ 100,00 + R$ 130,63; conferido após recarregar. f PASS: Fechamento 01–15/11 receita R$ 456,25, custo R$ 230,63, resultado R$ 225,62 (49,5%), conciliação "Confere" nas 6 parcelas. g PASS: Excel do cliente (2 abas) sem custo/margem/resultado, total R$ 456,25. h PASS: fatura única HOMOLOG-SINT-AV R$ 456,25 / custo R$ 230,63 "Fechada", sem ação de edição; apontamentos faturados com 6 campos desabilitados, "Corrigir" ausente, Salvar → "Nenhuma alteração para salvar". i PASS (observação): botão "Adicionar serviço de container" no cartão da avulsa leva a `/containers/novo?operacao=622cbc76…`, formulário "Novo serviço de containers" com cliente e operação pré-preenchidos (não salvo) |
| Código e PR afetados | Nenhum código alterado. Apenas este HANDOFF, local, na branch do #121 (sem commit) |
| Ambientes envolvidos | HML, escrita sintética autorizada só pelas telas: cliente, contrato, 2 colaboradores, operação avulsa `622cbc76…`, alocação sem turno, 2 apontamentos de 09/11, 1 fatura (imutável). Nenhum registro existente, conta, papel, Configurações, Implantação de vigências ou flag alterado; operação não atribuída a conta operacional. Production, código, `.env` e `vercel.json` intocados. `next dev` reescreveu `AGENTS.md`: restaurado. Prints e o Excel fora do repositório (scratchpad da sessão, `hml-avulso-01`) |
| Pendências e decisões | (1) Campo "Valor acordado por diária (avulsa)" aparece na criação mas é recusado com o motor por vigência ligado: esconder/desabilitar ou levar ao registro de vigência com motivo. (2) Botão "Adicionar serviço de container" em toda operação abre o módulo Containers (valor negociado + custo por participante): risco de cobrar o mesmo serviço duas vezes (diárias + container); recomendação: esconder no cartão (ou redirecionar para adicional no Faturamento) enquanto o módulo fica só por URL; o formulário ainda mostra "Voltar para containers", tela que saiu do menu. (3) Atritos: colaborador nasce com "Revisar função"; sem turno, horários vêm vazios e intervalo 0 (preencher à mão em cada linha); operação mostra "Localidade ausente. Defina a vigência antes de apontar com o motor ligado." mas o apontamento foi aceito; apontamento faturado sem rótulo "Faturado", folha "Aberto", Salvar/Fechar dia habilitados; "Gerar fatura" sem confirmação; nome com "–" (travessão) difícil de digitar. Decisões de negócio abertas: tipos de serviço, unidade/modalidade, remuneração |
| Próxima ação exata | Ponto (2) decidido pelo usuário: esconder o botão, feito localmente (ver abaixo). Falta decidir o ponto (1). #121 segue Draft até autorização nominal de merge |
| Complemento — botão escondido (09/11/2026) | Decisão do usuário: esconder "Adicionar serviço de container". Removidos o `Button`/`Link` do cartão da operação e o import `Link` (sem outro uso) em `painel-operacoes.tsx`; `scripts/test-container-telas.mjs` passa a exigir a ausência do atalho. Rota `/containers/novo?operacao=` e links do Faturamento mantidos. Windows sobre `c32a93f` + diff local: lint, tsc, check:workflow, check:vercel-deployments, build e diff --check PASS; `test:container-telas` 65/0; 69/72 `test:*` (as 3 de ambiente de sempre). Navegador localhost:3001 → HML, admin, sem salvar: 8 cartões de operação sem o botão e sem link para `/containers`; `/containers` abre por URL com 11 serviços. Publicado no #121 por autorização do usuário |
| Autorizações e proibições | Autorizada e concluída: escrita sintética `HOMOLOG-SINT-AV` no HML pelas telas, incluindo uma fatura. Proibidos: alterar registros existentes, contas, papéis, Configurações, Implantação de vigências, flags, código, banco, migrations, `.env`, `vercel.json`, commit/push/merge/PR, Production, atribuição a conta operacional |

### Tarefa anterior — UX-AVULSA-02 (09/11/2026, PR #121 Draft)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-AVULSA-02 (09/11/2026): retirar o item "Containers" da navegação lateral do admin. Decisão do responsável: serviço de container passa a ser registrado como operação avulsa em Operações (nome do serviço, equipe e diária). Nada apagado: rotas, ações, componentes, migrations 045–050 e dados de containers permanecem |
| Resultados e testes comprovados | `src/app/(painel)/_components/app-shell.tsx`: removido `{ href: "/containers", label: "Containers", icon: Package }` e o import `Package`, sem outro uso (o lint reprovaria). Expectativas que conferiam o item: `scripts/testar-papel.mjs` E5 9 → 8 links, `TELAS_NAV` exclui `containers` como já excluía `usuarios` (a rota segue em `TELAS`, com guard e rota conferidos) e nova E5c "containers NÃO é item da navegação principal"; `scripts/testar-tela-operacional.mjs` B15 9 → 8. Windows, Node 26.13: `npm run lint` PASS, `npx tsc --noEmit` PASS, `check:workflow` PASS, `check:vercel-deployments` PASS, `test:papel` 111/0, `test:tela-operacional` 170/0, 69/72 `test:*` PASS, `npm run build` PASS, `git diff --check` PASS. Falham por ambiente Windows, iguais às da UX-AVULSA-01: `test:calendario-runners` 10/13, `test:workflow` 7/1, `test:vercel-deployments` 0/22. Navegador (app do worktree em `localhost:3001`, CSP → `qbnfcm…`, admin): menu com Dashboard, Apontamentos, Operações, Clientes e contratos, Colaboradores, Faturamento, Fechamento, Relatórios; `/containers` abre por URL direta com 11 serviços; Nova operação → tipo "Avulsa" mostra valor acordado por diária e data; cancelado, cartão Avulsas segue em 1 |
| Código e PR afetados | `src/app/(painel)/_components/app-shell.tsx`, `scripts/testar-papel.mjs`, `scripts/testar-tela-operacional.mjs`, `docs/HANDOFF.md`. PR Draft desta branch contra main |
| Ambientes envolvidos | Local (worktree, `npm ci`, `next dev` na porta 3001 lendo o `.env` existente sem alterá-lo, encerrado ao fim) e CI. HML só lido. Nenhum banco, Production, `.env`, chave de serviço, flag, migration, cálculo, faturamento, auth, `vercel.json` ou workflow tocado. O `next dev` reescreve `AGENTS.md` com bloco "nextjs-agent-rules": restaurado, fora do commit |
| Pendências e decisões | Links restantes para `/containers`, mantidos de propósito: `faturamento/adicionais.tsx` (import de `../containers/_acoes`, `router.push` linha ~144 e `href` linha ~336) e `operacoes/painel-operacoes.tsx` linha ~701 (botão "Adicionar serviço de container" → `/containers/novo?operacao=…`). Testes que referenciam rotas `/containers` seguem válidos (`test-container-telas`, `test-container-dados`, `testar-func-ready`, `testar-compatibilidade-deploy`). Decisões abertas: lista de tipos de serviço, unidade e modalidade de cobrança dos avulsos (diária, unidade, valor fechado como adicional), remuneração por pessoa ou rateio, destino final do módulo Containers. Pendentes anteriores abaixo seguem válidos |
| Próxima ação exata | Concluída: PR #121 Draft, CI validar/sql-local SUCCESS em `c32a93f` |
| Autorizações e proibições | Autorizados: worktree/branch, `npm ci`, remoção do item de menu e das expectativas que o conferiam, commit/push desta branch e um PR Draft; Preview automático (não é homologação). Proibidos: banco, migrations, RLS, grants, flags, cálculo/faturamento, auth/MFA, `vercel.json`, workflows, apagar/alterar rotas, ações, componentes ou dados de containers, remover os links listados, escrita no HML, Production, `.env`, chave de serviço, merge, Ready, force push, outro PR |

### Tarefa anterior — UX-AVULSA-01 (09/11/2026, #120 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-AVULSA-01 (09/11/2026): trocar três textos da tela Operações que prendiam a avulsa a "carga e descarga". O tipo do serviço avulso passa a ser dito pelo nome da operação (decisão do responsável). Menu e módulo "Containers" inalterados |
| Resultados e testes comprovados | Trocas: (1) `painel-operacoes.tsx`, opção do tipo "Avulsa (carga/descarga)" → "Avulsa"; (2) `painel-operacoes.tsx`, cartão "Avulsas" description "Carga e descarga" → "Serviços pontuais"; (3) `operacoes/page.tsx`, metadata description → "Operações fixas e avulsas, com turnos, intervalos e equipe alocada." (uma linha, exigência do Prettier corrigida à mão). Nenhuma suíte conferia os textos antigos. Windows, Node 26.13: `npm run lint` PASS, `npx tsc --noEmit` PASS, `check:workflow` PASS, `check:vercel-deployments` PASS, 69/72 `test:*` PASS, `npm run build` PASS (66 s, 24 páginas), `git diff --check` PASS. Falham `test:calendario-runners` (Python ausente), `test:workflow` (separador `\`) e `test:vercel-deployments` (caminho `C:\C:\…PC%20CASA`) com contagens idênticas no checkout original em `d0e7143` sem a mudança: ambiente Windows, a confirmar na CI Linux |
| Código e PR afetados | `src/app/(painel)/operacoes/painel-operacoes.tsx`, `src/app/(painel)/operacoes/page.tsx`, `docs/HANDOFF.md`. PR Draft desta branch contra main, incluindo os 3 commits de documentação herdados |
| Ambientes envolvidos | Local (worktree, `npm ci`) e CI. Nenhum banco, HML, Production, `.env`, chave de serviço, flag, migration, cálculo, faturamento, auth, `vercel.json` ou workflow tocado |
| Pendências e decisões | Evolução dos serviços avulsos: lista de tipos reais, unidade/modalidade de cobrança (diária, unidade, valor fechado), se toda avulsa é por diária, remuneração por pessoa ou rateio, futuro do menu "Containers". Outras ocorrências não alteradas (fora do escopo): `painel-operacoes.tsx` "Operações fixas usam turnos diários; avulsas registram data e valor acordado." e "Valor acordado por diária (avulsa)"; `operacoes/page.tsx` openGraph "Operações fixas e avulsas com turnos e equipe alocada."; dashboard "Distribuição entre operações fixas e avulsas."; `/containers` "Serviços avulsos, valores negociados e custos por participante." Nenhuma outra menção de interface a carga/descarga em `src/` ou `scripts/`. Pendentes anteriores abaixo seguem válidos |
| Próxima ação exata | Concluída: CI validar/sql-local SUCCESS em `5cec5cf` e `9eb628f`; #120 mesclado pelo usuário em `f3f846e` |
| Autorizações e proibições | Autorizados: worktree/branch, `npm ci`, os três textos, commit/push desta branch e um PR Draft; Preview automático (não é homologação). Proibidos: banco, migrations, RLS, grants, flags, cálculo/faturamento, `billing.ts`, auth/MFA, `vercel.json`, workflows, HML, Production, `.env`, chave de serviço, módulo/menu "Containers", tipo/unidade/quantidade de serviço, merge, Ready, force push, outro PR |

### Tarefa anterior — homologação da interface (09/11/2026)

| Campo | Valor |
| --- | --- |
| Tarefa executada | Homologação funcional da interface dos 9 cenários (09/11/2026), app Next local (`localhost:3000`, `.env` → HML `qbnfcmrxmssnwkhaitgd`), navegador do app; admin `bcviniciuslc@gmail.com` (sem MFA) nos cenários 1–8 e `s11-op@e2e-sintetico.invalid` no 9. Preview não usado (exige login Vercel; vínculo não comprovado) |
| Resultados e testes comprovados | **9/9 PASS** (prints na sessão). 1 Dashboard abre com R$. 2 container pedido = execução (09/11) salvo. 3 pedido 10/11 > execução 09/11 recusado na tela ("A solicitação não pode ser posterior à execução."), lista continua com 10 serviços. 4 correção 300 → 320: novo `6872ba95…` disponível, original `a3cf5ae1…` Cancelado/substituído com vínculo e auditoria. 5 adicional R$ 75 com duplo clique: um só. 6 8h = R$ 250,00; 9h30 = R$ 320,31 (HE R$ 70,31), custo R$ 120,00 e R$ 154,38, conferido após recarregar. 7 Fechamento 01–15/11 R$ 965,31, conciliação com banco "Confere" em todas as parcelas; Excel do cliente (2 abas) sem custo/margem/resultado, total R$ 965,31. 8 fatura `c40428d0…` R$ 965,31/custo R$ 324,38 Fechada; sem ação de edição; container faturado sem Corrigir/Cancelar e `/corrigir` recusado; apontamento faturado com campos desabilitados ("Nenhuma alteração para salvar"). 9 operacional entra em `/operacional`, vê só "E2E-S11 Operação A1", nenhum `R$`/termo financeiro na página, menu só `/operacional`; `/dashboard` redireciona para `/operacional`; `/faturamento` e `/fechamento` mostram "Área administrativa restrita". Somado à camada banco/RPC anterior (38/38 PASS) |
| Código e PR afetados | Nenhum código alterado. Apenas este checkpoint, local |
| Ambientes envolvidos | HML com escrita sintética autorizada e persistida: cliente `HOMOLOG-SINT-UI` (`a7c38a8c…`), contrato `HOMOLOG-SINT Contrato UI` (R$ 250, 8h, 1,5, vigência 01/11/2026), colaboradores `HOMOLOG-SINT Colaborador 1/2` (custo R$ 120/130 desde 01/11), operação `HOMOLOG-SINT Operacao UI` (`4a5a47dc…`) e turno, 2 containers, 1 adicional, 2 apontamentos de 09/11, fatura `c40428d0…` (imutável). Nenhum registro existente alterado; contas de usuário, Configurações e Implantação de vigências intocadas; resolução comercial OFF. Production não tocada |
| Pendências e decisões | Observações de UX (não reprovam cenário): "Gerar fatura" emite sem confirmação; apontamento faturado não exibe "Faturado", folha segue "Aberto" e "Salvar"/"Fechar dia" ficam habilitados; cenário 3 recusado no cliente antes do servidor (recusa do banco provada na rodada banco/RPC); aviso "Localidade ausente" na operação não bloqueou apontamento. Download do Excel no navegador do app ficou como `.tmp` em Downloads. Pendentes anteriores: Production 034 → 050 com `pg_dump`; três particularidades da Dynamis; prévia `src/lib/billing.ts` `<= 15`/`<= 45` × banco `< 15`/`< 45`; dados `HOMOLOG-SINT` no HML exigem tarefa própria se for limpar |
| Próxima ação exata | Superada pela UX-AVULSA-01 acima (checkpoint publicado nesta branch por autorização do usuário) |
| Autorizações e proibições | Autorizada naquela tarefa: escrita sintética `HOMOLOG-SINT` no HML pelas telas, incluindo uma fatura. Não se estende a outras escritas |

## Próxima ação exata, na conta nova

1. Ler `CLAUDE.md`, `AGENTS.md`, este HANDOFF e `PROGRESS.md`; conferir main, PRs e HML (somente leitura).
2. Interface dos 9 cenários concluída em localhost → HML (9/9 PASS).
3. Para Production: `pg_dump` completo novo, token com acesso ao projeto de Production, janela e autorização nominal antes de aplicar 035–050.

## Segurança e limites da transferência

- Nenhuma senha, token ou `.env` real no Git. O token Supabase desta sessão está salvo no ambiente Default do Claude Code e só enxerga o HML.
- CI SUCCESS, Preview READY, migration aplicada, flag ON, HML homologado e Production liberada são estados distintos.
- As seções históricas abaixo preservam registros datados; não são instruções vigentes.

## Autorizações

Escritas sintéticas `HOMOLOG-SINT`, `HOMOLOG-SINT-AV` e `HOMOLOG-SINT-AV2` concluídas, não vigentes. #119–#123 mesclados pelo usuário. DOC-01 (vigente): `PROGRESS.md` e `docs/HANDOFF.md`, commit/push na branch `docs/progress-estado-atual` e um PR Draft. Não se estendem a código, HML, Production ou ativação comercial.

## Proibições

Sem deploy ou migration em Production, escrita no HML, emissão de fatura, resolução de tarifas ON, dados reais, mudança de dependências, criação de ambiente/Supabase, reaplicação de migrations, Gates 3–5 do checkpoint automático, merge ou Ready do PR da DOC-01 sem autorização nominal.

## Retomada

Abrir `CLAUDE.md`, `AGENTS.md`, este HANDOFF e `PROGRESS.md`; conferir refs, CI e HML por leitura. As seções históricas abaixo não transferem autorização.

## Evidência automática de Preview

<!-- checkpoint-preview:start -->
Controlador instalado desativado: false &&, contents: read, --dry-run e flag OFF.
Gates 3–5 PAUSADOS. Nenhum recibo automático ou execução ativa autorizado.
<!-- checkpoint-preview:end -->

## Evidências

### RETOMADA-FUNCIONAL-01 — consolidação documental

#116 Ready/revisões/checks reconferidos sem bloqueio; squash do HEAD nominal
`ccfba1ab5629aa20200959ce8ab74532fa8b9f71`, base
`92478763af9674ecd327333020ea2a6f240ee404`, em 2026-11-09T11:55:57Z.
Nova main `75c47cd9a30e4888b197ca6ae27aa236c71ec589`, árvore idêntica ao candidato e quatro documentos.
[CI da nova main](https://github.com/therunnas/bslogistica/actions/runs/42612890409): validar/sql-local SUCCESS, controlador checkpoint
SKIPPED. Sem --admin, auto-merge, force push ou commit adicional na main.

Comparação paginada limitada a este merge, sem repetir auditoria: seis amostras,
217 deployments totais, mesmos43 Production; nenhum deployment do squash em qualquer
target/estado. Servido dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4, SHA38b43490a8e0913c62a4ee6047ef48a8288ca0dc,
aliases/domínios/proteção/Git preservados. main:false/Next.js e controlador
false &&/contents: read/--dry-run/flag ausente OFF continuam vigentes.

### RETOMADA-FUNCIONAL-01 — negócio e implementação

Resultado completo,17 itens, fontes por SHA, impacto/prioridade, aceite,
dependências/decisões e lotes: [matriz revisada](NEGOCIO_X_SISTEMA.md).

- Fonte de negócio: responsável em 08/11 no #112; cinco práticas ainda não
  confirmadas e a nova decisão comercial048 não foram inventadas pelo executor.
- #111/#112 continuam abertos Draft nos HEADs acima, CI atual SUCCESS e conflitos
  de integração. Não foram mergeados nem tiveram branches atualizadas.
- A main não mudou src/supabase desde38b, base da matriz antiga. #111 adiciona
  melhorias/correções e046–049 sem significar schema no HML ou Production.
- Correções do diagnóstico: função operacional já tem texto livre e catálogo
  extensível(quatro iniciais); Excel real/Dynamis têm evidências S13/S14. Não
  duplicar funções existentes nem reaplicar homologação histórica ao candidato.
- Divergência objetiva: pedido e execução no mesmo dia ainda são recusados por
  domínio/normalizador/constraint045, na main e no #111. D06 antigo validava essa
  recusa sob regra superada; a primeira correção proposta deve mudar esse aceite.
- Resolução comercial OFF não usa diária individual/tarifa na cobrança. A048
  propõe fallback quando ON e exige decisão comercial, aplicação e homologação
  próprias. Código local/CI e HML com045/flagsOFF são estados diferentes.
- 27 casos históricos FIN-PR-13 têm evidências mistas(HML/Excel e e-mail A05 local)
  e não aprovam todo #111; S19 mantém NO-GO global,
  283 PASS/64 BLOQUEADO/137 NÃO TESTADO. Sem novo teste de tela/banco nesta tarefa.

### Histórico AUTO-12 e anteriores — preservar escopos

Registros abaixo são históricos; próximas ações de Gate 3 neles contidas estão
PAUSADAS pela RETOMADA-FUNCIONAL-01. Não são autorização vigente de execução.

### AUTO-12 — preflight e squash

- Preflight remoto: main b26b6d8a93c71d30f26b52dbe7da02e34a10ee4b, #115 fda7fcc9df7b64d0393852c9cc5256624a7b9b52,
  mergeable/CLEAN, mesmos 17 arquivos/blobs, CI e Preview do próprio HEAD READY
  (`dpl_DoU8FnEvKPHnJ8kE5zzsXKBzQCRU`). Sem app, SQL/migration, dependência nova,
  alteração de vercel.json ou release #111/#112.
- Ready em 2026-11-09T04:05:15Z; reconsulta de checks/reviews/threads sem pendência
  ou bloqueio. CodeRabbit status success não é aprovação humana de código;
  revisão independente do mesmo candidato já constava da AUTO-11, sem repeti-la.
- Squash [#115](https://github.com/therunnas/bslogistica/pull/115),
  em 2026-11-09T04:07:30Z: `92478763af9674ecd327333020ea2a6f240ee404`, pai `b26b6d8a93c71d30f26b52dbe7da02e34a10ee4b`,
  árvore `a6e7ce724145aa7e52e8e59a49d9fb40f51b6675` idêntica ao candidato. Sem --admin, auto-merge,
  force push ou commit direto adicional na main. Os 17 arquivos foram reconferidos.
- [CI da nova main](https://github.com/therunnas/bslogistica/actions/runs/42560037734): validar/sql-local SUCCESS. Validação local nova:
  56 casos (26 automação/8 documentais/22 política Vercel), contrato/links,
  main:false, YAML/permissões/checkout confiável, composição CI/dependências e
  diff --check PASS. CI executou as verificações completas da nova main; os
  resultados locais 70 suítes/lint/TypeScript/build do AUTO-11 são históricos.

### AUTO-12 — Production e ausência de escrita

Baseline completa pré-merge: 216 deployments / 3 páginas, 43 Production.
Sete leituras completas pós-merge, com última leitura Vercel em 2026-11-09T04:12:39Z
(309 s após squash). O processo incluiu outras consultas GitHub e encerrou a
última amostra composta em 2026-11-09T04:12:44Z, 315,0 s medidos após merge.
É amostragem delimitada, não garantia contínua/infinita.

| Evidência | Antes | Depois |
| --- | --- | --- |
| Total deployments | 216 | 216 |
| Production (todos os estados) | 43 IDs | Os mesmos 43 IDs, zero novo/removido |
| Servido | dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4 | Idêntico |
| SHA servido | 38b43490a8e0913c62a4ee6047ef48a8288ca0dc | Idêntico |
| Deployment do squash | Nenhum | Nenhum target/estado, inclusive staged/failed/cancelled |
| Domínios/aliases/proteção/Git | Baseline | Idênticos |
| Refs publicadas | Baseline | Somente main avançou pelo squash autorizado |
| Recibos automáticos | Nenhum na árvore candidata | Nenhum novo |

Aliases preservados: admin.bslogisticas.com.br,
bs-logistica-sistema-bslogisticas.vercel.app,
bs-logistica-sistema-git-main-bslogisticas.vercel.app e
bs-logistica-sistema-gold.vercel.app. Production Branch main, conexão Git,
proteção all_except_custom_domains, overrides e hooks sem divergência.
Nenhum deployment/ajuste administrativo executado. Zero incidente operacional.
Nenhum commit publicado pelo controlador: refs comparadas, main sem avanço além
do squash, #111/#112/candidato preservados e job sem passos. Este registro manual
posterior em branch própria é autorizado e não é recibo automático.

### AUTO-12 — instalação e evento observado

Os dois arquivos estão na branch padrão: checkpoint-preview.yml e
checkpoint-preview-signal.yml. A API registra os workflows como state active;
isso significa definição registrada, não controlador operacionalmente ativado.
O bloqueio versionado false && e a flag OFF mantêm o job desligado.

[Evento workflow_run observado](https://github.com/therunnas/bslogistica/actions/runs/42560278574), run 42560278574,
SHA `92478763af9674ecd327333020ea2a6f240ee404`, branch main, criado em 2026-11-09T04:10:07Z:
workflow Checkpoint Preview e job checkpoint **SKIPPED**, zero steps.
A API comprova o estado; a condição false && é sempre falsa e a flag estava
verdadeiramente ausente/OFF. Não houve checkout, token de job exercido ou CLI
executada; permissões read são as declaradas, sem afirmar teste efetivo do token.
Sem dry-run hospedado ativo, escrita ou recibo. Nenhum evento foi fabricado.

Travas reconferidas no código da main: false &&, contents/actions/deployments/
pull-requests read, --dry-run, flag ausente/OFF, sinal com permissions vazio e sem
checkout/escrita, controlador confiável github.workflow_sha e persist-credentials
false. Default workflow permissions do repositório read; nenhum segredo/variável
ou credencial criado. Gate 1/vercel.json/Next.js/lockfile e controles preservados.

Fechamento documental desta branch: 34 casos (automação/contrato documental)
reexecutados PASS, links canônicos e diff --check PASS; revisão independente
sem bloqueio importante. A precisão entre horário da Vercel e duração agregada
foi corrigida sem repetir o ensaio. CI/Preview desta documentação têm SHA e
checks próprios a consultar no GitHub, sem commit recursivo somente de status.

### Histórico AUTO-11 e anteriores — preservar datas e escopos

Os registros seguintes pertencem às suas etapas. Expressões como candidato,
ausente da main ou merge não autorizado descrevem a situação daquela data;
foram superadas somente pela integração nominal AUTO-12 acima. Não são autorização
vigente nem prova de Gate 3, escrita ou homologação funcional.

### AUTO-11 — consolidação documental comprovada

- #114 ajustou somente referências transitórias em HANDOFF, PROGRESS e ESTADO;
  HEAD final `0917e0c16e8480bcb74e7a638027e91dfd961c26`, três blobs remotos
  conferidos, CI/Preview próprios aprovados, Ready e nenhuma revisão/thread
  bloqueante. CodeRabbit não produziu aprovação de código (política do serviço).
- Squash em 2026-11-09T03:23:27Z: `b26b6d8a93c71d30f26b52dbe7da02e34a10ee4b`,
  pai `2561b919da5ab31e0ed1882864ee069b9961b6f7`, árvore idêntica ao candidato.
  [CI da nova main](https://github.com/therunnas/bslogistica/actions/runs/42556140779):
  validar e sql-local SUCCESS, sem supressão de checks ou --admin.
- Leituras completas/paginadas antes e após o squash, até 03:26:42Z (191,3 s):
  215 deployments totais, mesmos 43 Production, zero deployment associado ao
  squash em qualquer target/estado, Git e main:false preservados. Servido
  `dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4`, SHA
  `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`, mesmos aliases/domínios/proteção.
  É verificação desta consolidação, não nova homologação ou repetição do AUTO-10B.

### AUTO-11 — composição mínima do Gate 2

Branch criada de b26b6d8, fonte seletiva #111
`7e08270011f74ea5dfe4470097f58659eea81140`. Sem merge/cherry-pick de release,
sem app, SQL/migrations, lockfile, documentos de negócio #112 ou nova dependência.
O [guia técnico](continuidade/CHECKPOINT_AUTOMATICO.md) descreve os componentes,
limites e o plano do Gate 3. HANDOFF permanece entrada única de continuidade;
AGENTS/CLAUDE compartilham contrato literal de sete campos por tarefa.

Workflows permanecem com **false &&, contents: read, --dry-run e flag OFF**.
Sinalizador sem checkout/escrita; controlador usa github.workflow_sha confiável,
sem executar código/artefatos de PR. Nenhum secret ou variável foi configurado.
A composição é candidata; workflow_run depende da instalação na branch padrão,
ainda não autorizada. Sem dry-run hospedado, recibo ou escrita automática real.

Testes desta composição (não transferidos do #111): 70 suítes Node PASS; 26 casos
cobrem repetição/idempotência, CAS/conflito/resposta perdida, SHA/CI/origem/branches,
falha de consulta/evidência insuficiente, documentação/loops e locks. Mais 8 casos
documentais e 22 de política Vercel. Lint e TypeScript PASS. YAML validado e CI
comparada estruturalmente à base: só histórico completo no checkout de validar,
gate HANDOFF e suíte nova; Gate 1/permissões/jobs restantes intactos. Build padrão Turbopack PASS em 31,73 s
com placeholders públicos inertes, sem .env/credenciais reais. Diff --check e
revisão de segurança PASS. Revisão independente da composição sem achado crítico
ou importante para o Draft; observação de contrato CLAUDE corrigida e teste do
checkout confiável/cache/artefatos reforçado, 26 casos reexecutados PASS. Nenhum
resultado de teste hospedado/CI/Preview do candidato é presumido antes de sua
consulta no SHA publicado. Consultar checks próprios sem commit recursivo só
para registrar status.

Históricos seguintes mantêm seus SHAs/resultados e não representam autorização
vigente. AUTO-06 FAIL, AUTO-07 PASS e AUTO-08 TRANS-MAIN PASS seguem independentes.

### AUTO-10 interrompido e preservação local

AUTO-10 parou antes do merge por falta de confirmação da Fase 3. Na retomada
AUTO-10B, o proprietário confirmou disponibilidade, acesso administrativo funcional
e ciência do incidente. Proprietário decide/autoriza eventual recuperação;
executor monitora e interrompe a progressão em caso de falha. Nenhuma nova pergunta
de confirmação foi feita; não houve sinal de indisponibilidade durante a operação.

Os três documentos locais de AUTO-10 não foram sobrescritos: permaneceram no
worktree original e foram preservados byte a byte, com manifest/patch local em
/private/tmp/bs-checkpoint-auto-10b/preserved-local-docs. O novo worktree foi criado
da main integrada. Seu histórico relevante foi incorporado aqui; não depende do
acesso a esses artefatos para conhecer o resultado. #111 não sobrescreveu a main.

### Integração e baseline

- Autorizado: HEAD `53dce23e4973b1f1474fe165c415a307335929a0`, base `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`. Diff remoto de oito arquivos/blobs
  reconferido; 212 deployments completos/3 páginas, 43 Production, nenhum ativo.
- Ready confirmado em 2026-11-09T02:17:27Z; checks mantidos SUCCESS,
  zero threads/reviews bloqueantes. CodeRabbit pulou revisão automática por política
  do serviço para este OSS; não foi aprovação de código. Revisão local anterior e
  autorização nominal do mesmo HEAD preservadas; sem bypass --admin/auto-merge.
- Squash #113 em 2026-11-09T02:22:12Z: `2561b919da5ab31e0ed1882864ee069b9961b6f7`, pai `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`, árvore
  `265ea1b74a1d567f6be81e1cb0d2b7991f2031cd` idêntica ao candidato autorizado. Sem funcionalidade da release.
- main:false exclusivo e framework nextjs conferidos na main, com validador,
  testes, CI e documentação autorizados. [CI do SHA integrado](https://github.com/therunnas/bslogistica/actions/runs/42550552142):
  validar/sql-local SUCCESS. Nenhuma migration/SQL ou alteração Supabase.

### Janela Production e controle Preview

| Evidência | Antes | Depois da janela |
| --- | --- | --- |
| Horário UTC | 2026-11-09T02:22:16Z | 2026-11-09T02:52:26Z |
| Production servido | dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4 | dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4 |
| SHA servido | 38b43490a8e0913c62a4ee6047ef48a8288ca0dc | 38b43490a8e0913c62a4ee6047ef48a8288ca0dc |
| IDs Production | 43 | 43, mesmo conjunto; zero novo/removido |
| Total deployments | 212 | 213; único novo é o Preview de controle |
| Deployment do merge | nenhum | nenhum target/estado; nenhum objeto GitHub de deployment do SHA |

Janela real de **1810.0 segundos**, 49 amostras,
histórico completo repaginado em cada leitura, queries bem-sucedidas. Nenhum novo
Production/staged Production, failed/cancelled indevido ou incidente observado.
Mantidos Git, Production Branch main, configuração, domínios, proteção e aliases
Production: admin.bslogisticas.com.br, bs-logistica-sistema-bslogisticas.vercel.app,
bs-logistica-sistema-git-main-bslogisticas.vercel.app e
bs-logistica-sistema-gold.vercel.app. Nenhum alias/domínio modificado manualmente.

Controle na branch `docs/checkpoint-auto-10b-gate1-result`, criada de `2561b919da5ab31e0ed1882864ee069b9961b6f7`:
commit `0732b66e85b3768101da854307ba6a5a32a6d25c` alterou só HANDOFF. Push sem PR em
2026-11-09T02:26:02Z não produziu status/deployment nas leituras
anteriores ao Draft. Após abrir #114 em 2026-11-09T02:30:26Z, Vercel gerou
`dpl_FbRVLLpDoBw7c2zzeCa5Ki5foZYS`, [Preview](https://bs-logistica-sistema-3ptokhj9b-bslogisticas.vercel.app), READY/source Git,
target Preview (null), SHA/ref corretos e gitSource.prId=114.
GitHub deployment `7645579824` success. STAGED como
subestado de Preview não é staged Production. Branch/commit/deployment preservados.

O caminho automático via PR foi comprovado. Não afirmar que push isolado sem PR
foi comprovado nem inferir sua causa. Não houve deploy manual, mudança Vercel,
bypass, autenticação funcional ou homologação a partir de READY/HTTP 200.
O fechamento documental posterior pode gerar outro Preview autorizado; ele tem
SHA/checks próprios e não pertence à contagem da janela acima.

### Histórico AUTO-10B — proposta do Gate 2 então não preparada

Reutilizado o [plano existente do #111](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/docs/continuidade/CHECKPOINT_AUTOMATICO.md),
sem repetir auditorias. Fonte atual `7e08270011f74ea5dfe4470097f58659eea81140`; base futura deve ser redescoberta
após a decisão sobre este checkpoint, não fixada permanentemente em `2561b919da5ab31e0ed1882864ee069b9961b6f7`.

| Caminhos | Preparação futura |
| --- | --- |
| .github/workflows/checkpoint-preview.yml; checkpoint-preview-signal.yml | Adicionar definições mínimas, sem executar candidato/artefato não confiável |
| scripts/atualizar-checkpoint-preview.mjs; checkpoint-preview.mjs; checkpoint-github-api.mjs; testar-checkpoint-preview.mjs | Adicionar três módulos Node nativos/locais e suíte; sem pacote ou segredo novo |
| scripts/validar-workflow-documental.mjs; testar-workflow-documental.mjs | Atualizar contrato compartilhado; checkpoint coerente com main, não com a release |
| package.json; .github/workflows/ci.yml | Somente novo teste/gate de HANDOFF e dependência de histórico necessária; preservar step Gate 1, jobs, Node 24 e permissões existentes |
| AGENTS.md; CLAUDE.md; docs/WORKFLOW.md e guia/checkpoint | Patches mínimos do contrato documental; sem copiar HANDOFF/release/#112 por arrasto |

Manter obrigatoriamente **false &&, contents: read, --dry-run e flag desligada**.
CHECKPOINT_AUTO_ENABLED: absent; disabled by default. Nenhuma variável ou segredo foi alterado.
workflow_run depende da definição na branch padrão; não contornar com escritor
em PR, PAT ou execução de código do candidato. Sem token Vercel/bypass/Supabase.
Validar composição isolada com testes próprios, idempotência, CAS/expectedHeadOid,
reprocessamento, dados incompletos, falha segura, loops e logs sem segredo. Não
emprestar os testes do #111 como prova de uma composição ainda não criada.

AUTO-11 autoriza criar/publicar PR Draft mínimo do Gate 2 da main então atual,
somente após consolidar #114 e verificar main/CI/Production. A integração do Gate 2
exige aprovação nominal separada. Instalação na main não realizada; gates 3 (dry-run), 4 (escrita) e 5 (recibo)
continuam sujeitos a autorizações independentes. Rollback sempre preserva
main:false; qualquer intervenção administrativa continua sem autorização.

### Histórico AUTO-10B — estado publicado e limites

#113 mergeado; #111 `7e08270011f74ea5dfe4470097f58659eea81140` e #112 `2d1c0cde7bd47154a281171d77858b530d0b6de2` permanecem
abertos Draft, sem integração ou reconciliação funcional. Controlador ausente na
main e desativado no #111. AUTO-06 FAIL/AUTO-07 PASS/AUTO-08 PASS mantêm escopos
históricos independentes. Nenhuma Production homologada por esta tarefa.

Artefatos sanitizados locais em /private/tmp/bs-checkpoint-auto-10b; evidências
essenciais constam aqui. O resultado foi registrado no #114; consultar no GitHub
o HEAD/SHA de integração e seus checks próprios, sem
transferir CI da main/smoke nem criar commits recursivos só para registrar checks.

### Histórico da main anterior ao AUTO-10B

Registros seguintes preservados da main integrada, com datas e limites originais.
Não são autorização atual nem nova auditoria financeira/Production.

### Gate 1 — baseline e candidato (08/11/2026 BRT; horários UTC)

- Retomada #111 em 7e08270011f74ea5dfe4470097f58659eea81140 e #112 em
  2d1c0cde7bd47154a281171d77858b530d0b6de2, ambos abertos Draft e preservados.
  Branch nova nasceu da main 38b4349, sem cherry-pick ou incorporação dos PRs.
- API Vercel em 2026-11-09T00:22:34Z: projeto bs-logistica-sistema,
  prj_K1OJ6G7AWnx6dQB1BDsy3HTELnCV, Git therunnas/bslogistica, Production Branch
  main; sem hooks nem overrides build/install/output/root/ignored-step retornados.
  Autoassign true e Standard Protection all_except_custom_domains preservados.
  Nenhuma configuração administrativa alterada; sem divergência material AUTO-08.
- Production servido: dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4, SHA
  38b43490a8e0913c62a4ee6047ef48a8288ca0dc. Aliases: admin.bslogisticas.com.br,
  bs-logistica-sistema-bslogisticas.vercel.app,
  bs-logistica-sistema-git-main-bslogisticas.vercel.app e
  bs-logistica-sistema-gold.vercel.app. Sem promoção/cancelamento ou alteração.
- Lista completa pré-publicação: 43 deployments Production (paginação completa,
  sem filtro de estado), registrados para comparação após o push. CI da main
  base: validar/sql-local success; permissão global de workflows read.
- vercel.json da main tinha somente $schema e framework nextjs; candidato
  preserva ambos e acrescenta git.deploymentEnabled exatamente {"main":false}.
  Nenhum booleano global, glob ou regra de outra branch; Previews habilitados por
  padrão. A regra ainda não está na main; o merge real segue acoplado a deploy
  enquanto a contenção não for integrada e comprovada.
- Validador/testes novos usam Node nativo, sem instalação de pacote. Executam
  contra JSON/arquivos reais temporários e códigos de saída, incluindo ausência,
  main:true, booleanos globais, globs, branch incorreta, inválidos, framework
  removido e duplicidade de chaves. CI acrescenta apenas um step após Setup Node,
  com check:vercel-deployments e test:vercel-deployments, sem mudar permissões.
- Testes escritos e observados falhando antes da implementação; 22/22 passaram
  depois. YAML comparado estruturalmente à main: removido o step novo, igualdade
  total de jobs/triggers/permissões/steps. Comandos do step executados com sucesso.
- 69/69 suítes Node e lint PASS. Primeiro tsc falhou em tipos .next de uma rota
  exclusiva do #111; origem comprovada no cache gerado. .next e tsbuildinfo
  anteriores preservados fora do checkout, tsc limpo PASS sem mudar app/tsconfig.
  Build padrão npm run build PASS (Turbopack, 136,42 s), com variáveis públicas
  inertes como na CI; nenhum teste/limitação antiga foi transferido a este SHA.
- Artefatos locais sanitizados/cache preservado em /private/tmp/bs-checkpoint-auto-09;
  não são checkpoint alternativo, não serão publicados nem são necessários à
  retomada. Resultados públicos finais serão registrados abaixo após criar o PR.

### Publicação do Draft e fechamento do checkpoint

PR [#113](https://github.com/therunnas/bslogistica/pull/113), aberto Draft contra
main, branch chore/gate1-production-deployment-guard. Código publicado em
`75fe207b77c936123af96000471f698ec8c23ecc`; diff remoto completo conferido: 8 caminhos e blobs idênticos
ao conjunto local revisado, sem src/SQL/migrations/auth/lockfile/controlador.

Conferência de `2026-11-09T00:36:26Z`: [CI validar e sql-local PASS](https://github.com/therunnas/bslogistica/actions/runs/42540864694),
Vercel success. Preview `dpl_52k9hWtcAtaKdsMtjujbZ6zZQFnp`, [URL](https://bs-logistica-sistema-6avmet2mx-bslogisticas.vercel.app),
source Git/branch/SHA corretos, target Preview/READY; recibo GitHub
`7644201426` success. CodeRabbit não revisou por ser Draft;
a revisão local independente não encontrou defeitos críticos/importantes.

Production preservada: mesmos 43 IDs, incluindo qualquer estado retornado;
zero novos Production, mesmo deployment servido/aliases/proteção/configuração
e mesmos HEADs de main/#111/#112. Nenhum comando de deploy ou alteração Vercel.

Este fechamento documental atende à etapa de registrar o resultado após criar o
PR; não muda código validado. Seu próprio SHA/checks/Preview devem ser consultados
no HEAD final do #113 e na entrega, sem emprestar PASS de 75fe207 nem fazer uma
série recursiva de commits só para registrar checks. SHA nominal de aprovação
será o HEAD final indicado na descrição do PR; qualquer alteração exige reaprovação.
Na AUTO-09, Gate 1 estava somente preparado; essa condição foi resolvida pelo squash e observação AUTO-10B registrados acima.

### Histórico AUTO-09 — proposta então futura, #113 integrado no AUTO-10B

1. Aprovar nominalmente o SHA final exato do Draft (HEAD da API, informado na
   descrição/entrega final); qualquer commit novo invalida a aprovação anterior.
   Reconfirmar a main e baseline servida acima; se divergirem, STOP/revisão.
2. Diff esperado: 8 arquivos — vercel.json, dois scripts Node, package.json,
   .github/workflows/ci.yml e HANDOFF/PROGRESS/ESTADO_DO_PROJETO. Zero src, SQL,
   migrations, lockfile, auth, documentos #112 ou controlador; sem release #111.
3. Checks obrigatórios para a decisão: validar/sql-local e Vercel no mesmo HEAD,
   22 casos da regra e validação documental/Node/lint/tsc/build aprovados. Nenhuma
   review bloqueante ou conflito pendente; CI verde não é homologação.
4. Janela proposta: 30 minutos após autorização, com responsável disponível e
   sem alterações concorrentes main/Vercel. Horário nominal e responsável devem
   ser confirmados pelo proprietário antes de integrar; não estão autorizados.
5. Método proposto: squash, após tornar Ready somente se autorizado, com
   --match-head-commit no SHA aprovado, sem --admin ou auto-merge. Reconsultar
   checks, reviews, threads e base imediatamente antes. Registrar o novo SHA do
   squash; ele difere do candidato e precisa de evidência própria.
6. Antes/depois: capturar lista paginada de deployments Vercel sem filtro de
   estado, targets e aliases, e eventos/statuses GitHub. Observar por pelo menos
   3 minutos após o push/CI e reconferir após o controle Preview, cobrindo atrasos.
   Exigir zero novos Production/staged/failed/cancelled associados à integração,
   mesmo Production servido/aliases/proteção/Git. Não usar somente saída da CLI.
7. Autorizar separadamente um evento sintético em branch Preview aprovada, sem
   regra de negócio, secrets ou banco. Exigir source Git, SHA/branch corretos,
   target Preview READY, main:false preservado e zero Production inesperados.
   O Preview deste Draft demonstra a branch atual; não substitui o controle
   posterior ao merge. Sem evento autorizado/evidência suficiente, BLOQUEADO.
8. Resposta a falha: FAIL/STOP e suspender progressão. O proprietário deve nomear
   antes quem poderá executar contenção administrativa e sob qual autorização.
   Nenhuma mudança de Production, alias, promoção ou cancelamento está permitida
   nesta etapa. Não reverter vercel.json retirando main:false: isso reabilitaria
   deployments. Qualquer correção/rollback deve preservar a trava e o histórico.
9. Só depois da prova real do Gate 1: Gate 2 controlador mínimo instalado mas
   desativado → Gate 3 dry-run hospedado em leitura → Gate 4 escrita autorizada →
   Gate 5 primeiro recibo automático. Cada gate requer autorização independente.

### Histórico da main anterior ao Gate 1 — não é validação desta tarefa

Os registros seguintes foram preservados da main base; datas, PRs e estado do
banco refletem suas sessões originais. Não foram reauditados ou atualizados por
inferência a partir da release #111.

- Sessão 11: PR #100 marcado Ready e mergeado por squash com `--match-head-commit`
  no HEAD autorizado `a391079671539ddd89b8e2cd910adb65d68c9a74`, depois de reconfirmar
  CI, Preview, `CLEAN` e ausência de revisões bloqueantes. `main` =
  `91513b91b11461ac48d8dfe6af118234bfb6fbc0`; CI de `main` (run `42077946742`)
  verde; deploy automático de Production `7581007010` em `success`.
- Sessão 12, Production: sem acesso à Vercel (sem CLI, token ou MCP), então nenhum
  rollback foi tentado. Não há candidato comprovadamente melhor: o último deploy
  anterior a qualquer migration 035+ é o de `3f5125c` (30/10, deployment
  `7441801844`), que descartaria os PRs FIN-PR-01 a 13 sem prova adicional; a `main`
  tem suíte de compatibilidade 034 → 045 (697 asserções) e Production já recebeu vários
  deploys nesse estado. Smoke não destrutivo: `/login` e `/esqueci-senha` 200;
  `/dashboard`, `/fechamento`, `/containers`, `/operacional`, `/faturamento` e `/mfa`
  redirecionam para `/login`; `POST /api/fechamento/xlsx-cliente` sem sessão responde 405.
  `max(version)` em Production = `20261101120000` (034), lido em transação `READ ONLY`.
- Sessão 12, HML: head `20261112120000` (045), 50 migrations, confirmado por leitura.
  Dump de dados de `public` antes das escritas. Contas e dados sintéticos
  `E2E-S11` (lista de IDs em
  [Homologação integrada](financeiro/homologacao-fin-pr-13.md)). Resolução
  comercial permaneceu **OFF**; o motor por vigência já estava ligado.
- Execução: app Next local (porta 3100) ligado só ao HML, JWT reais, TOTP real.
  Resultados por caso e achados na matriz. Nenhum defeito financeiro encontrado;
  um achado de documentação (regra de arredondamento da HE) e quatro observações.
- Sessão 13: resolução comercial ligada em HML só durante B02, C03 e C04 e restaurada
  para OFF (verificado). Navegador real (Chrome): C05, D04, D05, D09 e fluxos de
  recuperação. Microsoft Excel real (AppleScript): E03 e E04, com filtros aplicados.
  A05: papel e auditoria pela interface; recuperação sem MFA e com um TOTP. Regra da HE
  (15 → 30, 45 → 60) aprovada e corrigida em `ARQUITETURA.md`. Resultado 25/1/1/0.
- Sem Preview da Vercel apontado para HML (sem acesso à Vercel). Dynamis continua
  indisponível: E06 BLOQUEADO, sem inferência.

- Sessão 14: PR #101 mergeado por squash em `e7f77b0` (CI verde no HEAD `1371f07`; só
  documentação). A05 fechado em stack local isolada com captura de e-mail; E06 executado com
  a planilha Dynamis (SHA-256 `2b211d4c…18f7`, comparação por componente, sem paridade);
  achado G explicado sem alterar código; H corrigido no PR #102 (rótulos "fim exclusivo");
  novo achado I (margem do Dashboard sem custo de Containers) e dependência J (modelo de e-mail
  do convite). Manual de uso e plano 034 → 045 redigidos.

- Sessão 15: PR #102 mergeado (`b63d33b`). Achado I corrigido no PR #104 (custo de Containers
  na margem do Dashboard e dos Relatórios; 67/67 suítes, lint e tsc). Manual corrigido
  (Presente/Falta/Substituição; Faturamento; Relatórios) e runbook corrigido (os scripts
  `comparar-catalogo-*.sh` só operam no local). Config de Auth de HML e Production lida por
  `supabase config pull --dry-run` (nada gravado). **Backup novo de Production** em
  `~/bs-backups-producao/2026-11-05-034/` (cifrado, senha no Chaveiro) com restauração local
  comprovada; Production não tem dados de negócio.

- Sessão 16: #104 corrigido para o schema 034 (defeito medido no PostgREST real sobre o backup) e
  mergeado (`071ea6d`); margem total no Fechamento e no Faturamento no PR #105; backup verificado e
  restaurado (Auth funcional); ensaio integral 034 → 045 e reversão; checklists de e-mail e backup.
  Parecer: NO-GO condicional (runbook, seção 11).

## Migrations por ambiente

**09/11/2026 (vigente):** main até 050; HML 050 (046–050 aplicadas uma a uma, verificadas); Production 034. Registros abaixo são históricos.

FUNC-02: nenhuma migration aplicada nesta sessão. Main até 045, #111 candidatas
046–049, #118 com 050. Registros HML045/Production034 abaixo são históricos, não
catálogo reconferido. Antes de HML, cumprir o roteiro OFF/catálogo/backup na matriz.

FUNC-01 documental: nenhuma consulta/operação de banco ou alteração SQL. Os estados abaixo
são o último registro herdado da main, não reconferidos nesta tarefa.

- Esta etapa não criou nem aplicou migration.
- HML `qbnfcmrxmssnwkhaitgd`: 045; escritas apenas de dados sintéticos pelas RPCs e
  tabelas da própria aplicação, e uma transação com `ROLLBACK` (último admin).
- Production `ehkduqokntemtmqzdrbd`: 034; apenas leitura do head. Sem backup recente
  (último lógico: 23/10/2026).

## Autorizações históricas — não transferem autorização

FUNC-03 vigente: publicar os cinco ajustes documentais no #117 com commit/push normal; preparar/testar/publicar composição técnica em branch/PR Draft próprios. Sem merge ou migration remota.

**Histórico FUNC-02:** análise e preparação documental local naquela sessão. Nenhuma
autorização nova de commit/push, merge ou aplicação HML. A próxima publicação deve
ser autorizada para o diff documental revisto; depois cada integração/ambiente
exige seu escopo nominal. Autorizações anteriores abaixo são históricas.

Histórico da autorização FUNC-01: publicação dos cinco documentos em branch documental própria,
testes, commit/push normal e PR Draft contra main. A correção funcional do item7
foi autorizada em branch/PR separados e está sob preparação, sem reutilizar o
HANDOFF obsoleto do #111/#112. Nenhum merge foi autorizado nesta etapa.
Gates 3–5 da automação PAUSADOS; HML/Supabase, migrations remotas, Production,
credenciais e flags exigem autorização própria. O squash #116 é histórico concluído.

Histórico AUTO-09: implementação mínima, testes, commit/push normal somente na
branch chore/gate1-production-deployment-guard e criação de PR Draft contra main.
Merge e mudanças de main/Production não autorizados. Os itens abaixo são históricos.

- sessão 11: ready e squash merge do PR #100 condicionados ao HEAD exato;
- sessão 12: proteger Production (rollback só com candidato comprovado), preparar HML
  com identidades e dados sintéticos, executar a matriz de 27 casos e atualizar a
  documentação. Nenhuma foi usada para alterar Production.

## Proibições históricas — prevalece o escopo atual acima

FUNC-03 vigente: sem merge, SQL remoto, Production, dados reais, ON comercial, controlador, Gates 3–5, novas infraestruturas ou alteração do #118 original.

**Histórico FUNC-02:** sem merge, migrations/SQL remotos, flag comercial ON, Production,
controlador ou Gates 3–5, nova infraestrutura, dados reais, commit/push não
autorizados. Não atualizar #111/#112/#118 remotamente por inferência.

Sem iniciar Gates 3–5, remover false &&, habilitar flag/contents: write/--write,
recibos automáticos ou alteração de workflow. Sem merge documental/funcional,
merge/atualização #111/#112, Supabase/HML/Production, migration remota, limpeza de
dados, credenciais, aliases/domínios, deploy manual, force push, novos projetos ou
site institucional. A branch documental só publica os cinco arquivos autorizados;
app/SQL/migration nova locais do item7 pertencem ao PR funcional separado.
Preservar main:false e todos os históricos/worktrees.

Os limites AUTO-09 abaixo pertencem àquela sessão, não desfazem o squash concluído.

AUTO-09: sem merge, main direta, release #111/#112, Vercel real, HML/Supabase,
migrations, credenciais, dados, domínios/aliases, deploy manual, bot ou gates 2–5.

- sem migration em Production, dados de Production ou alteração de variáveis de Production;
- sem ligar a resolução comercial em HML sem autorização específica;
- sem e-mails reais, pagamentos externos, dados pessoais reais ou alteração de usuários reais;
- sem inferir regra comercial nem usar R$ 35.118,12 como fixture de outra base.

## Bloqueios e riscos

**11/11/2026 (vigente):** **bloqueio do piloto** — com a resolução comercial OFF, domingo é calculado como dia útil e feriado não muda a cobrança (teste no HML, com reversão: domingo 8 h = R$ 250,00 / custo R$ 150,00 / tipo "util"); a lista de feriados legada está vazia em HML e Production. Decisões pedidas ao responsável (regra de 100% na cobrança e no pagamento; resolução ON ou migration 051; cidade do piloto): ver `PROGRESS.md`, "Bloqueio do piloto".

**09/11/2026 (vigente):** interface dos 9 cenários PASS em app local ligado ao HML (Preview segue sem vínculo comprovado); Production 034 com frontend posterior (telas de schema novo indisponíveis até 034 → 050); backup `pg_dump` de Production pendente. Registros abaixo são históricos.

**FUNC-02:** três conflitos documentais entre #117/#118; prefixo 046–049 e
consumidores 047/049 ainda precisam de composição/CI. Main/#118 usam RPC antiga
revogada pela 047. Aplicação HML bloqueada até catálogo/backup/janela e autorização;
048 OFF não aprova fallback ON. Riscos anteriores abaixo conservam seus escopos.

- Gate 1 PASS é delimitado a esta janela/amostragem e ao Preview automático via PR;
  não é garantia infinita ou bloqueio universal de deploy manual/promoção.
- Gate 2 instalado desativado pelo AUTO-12; execução do Gate 3 e escrita dos Gates 4–5 dependem de novas autorizações. O bot não está ativo.
- Originais locais AUTO-10 foram preservados; não confundi-los com o checkpoint
  registrado no #114 ou substituir o estado da main pela release #111.
- Parágrafos funcionais seguintes são históricos, sem reconciliação nesta tarefa.

- Histórico AUTO-09: trava integrada no AUTO-10B; Gate 2 preparado no AUTO-11 e instalado desativado no AUTO-12. Nenhuma autorização se estende ao Gate 3.
- GitHub informa main sem proteção; o check falha diante de regressão, mas não
  impede por si só um merge administrativo. Nenhuma proteção/ruleset/permissão
  foi modificada. Exigir checks e revisão na decisão nominal.
- Git.deploymentEnabled governa eventos Git; não bloqueia universalmente deploy
  manual/promoção. Diferenças sandbox/Next.js e observação delimitada continuam
  limites. Não declarar Production homologada ou controlador ativo.
- Registros funcionais/banco seguintes são históricos da main; sem reconciliação
  funcional nesta tarefa nem autorização herdada desses parágrafos.

- **Histórico funcional: Production roda código 045 sobre banco 034.** Não é nova
  inspeção de banco. O acoplamento Git/Production referido nos registros antigos
  foi contido pelo Gate 1; esta etapa não altera código ou banco servido. Opções
  históricas de tratamento, sempre com autorização própria: manter
  (a compatibilidade 034 → 045 está testada), conter por rollback na Vercel com
  acesso administrativo, ou preparar 035–045 em Production com backup novo.
- Pendências reais: revisão humana dos PRs #103 e #104; **segunda cópia** do backup em outro
  local protegido; conferir no Dashboard do Supabase os **modelos de e-mail** de convite e
  recuperação, a **expiração** do link e a autenticação do domínio de envio (ver runbook, 1.2);
  decisão e autorização para implantar 035–045 em Production, com dump novo se houver escrita.
- Dados sintéticos em HML, com faturas emitidas (imutáveis), exigem tarefa própria de
  limpeza. Regra de arredondamento da HE aprovada e documentada na sessão 13.
- Manual de utilização e preparação de Production 035–045 são gates posteriores.

## Retomada histórica — não usar como tarefa ativa

1. Descobrir worktrees/branches/HEADs e preservar alterações de terceiros.
2. Conferir o novo HEAD do #117, seis documentos, CI e Preview próprios, mantendo Draft.
3. Localizar a branch técnica FUNC-03 criada da main atual; seu HANDOFF governa a composição.
4. Executar somente o restante da composição/testes locais 046–050 e publicar Draft técnico.
5. HML requer identidade/catálogo/backup/restauração/janela/Preview compatível/OFF e autorização separada. Sem merge ou ativação nesta tarefa.

### Retomada FUNC-02 — histórica


1. Descobrir worktrees, refs remotas e status; preservar os cinco ajustes locais
   FUNC-02 e os três originais AUTO-10. Esta branch ainda é #117 no SHA publicado
   73a3f35b2dca871e92b2623e84790c3b36308330, sem commit dos ajustes.
2. Ler a consolidação FUNC-02 na matriz e conferir main/#111/#112/#117/#118.
   Se os HEADs mudaram, reavaliar somente o delta pertinente.
3. Revisar/publicar documentos só após autorização: NEGOCIO.md idêntico ao #112,
   item 7 implementado no #118 e plano 046–050, sem checkpoints históricos ativos.
4. Preparar prefixo técnico com consumidores compatíveis e composição/CI próprias
   somente no próximo escopo autorizado. Resolver os três documentos e quatro
   inventários do #118 conforme a base resultante; não fazer merge por inferência.
5. HML: solicitar autorização própria para catálogo/backup/restauração/janela e
   aplicação/testes OFF, sem ativação comercial. C1–C6 e Gates 3–5 permanecem pausados
   ou pendentes conforme o plano; Production não faz parte desta consolidação.

### Retomada FUNC-01 — histórica, substituída pelos passos acima

1. Descobrir worktrees/status/HEADs; preservar os originais dos cinco documentos
   e os três originais AUTO-10 no outro worktree. Nenhum reset/rebase/descarte.
2. Ler o HANDOFF da branch/PR da tarefa e conferir HEAD/checks/Preview próprios.
   A publicação documental não altera main nem transforma Preview em homologação.
3. Reconfirmar main/#111/#112 e consultar matriz17 itens, decisõesC1–C6 e lotes.
4. Prosseguir com FUNC-01 item7 na branch/PR funcional separado, sem copiar o
   checkpoint obsoleto do #111/#112 ou ampliar os lotes comerciais.
5. Preços/contratos e homologação são gates financeiros independentes. Não aplicar
   migration remota, publicar Production ou retomar Gates 3–5 por inferência.
