# GATE-FIN-03 — Migration 053: intervalo maior que o tempo entre entrada e saída (I5)

Sessão 19 (14/11/2026, sessão em nuvem, Linux, Supabase local descartável). Branch
`fix/gate-fin-03-migration-053`, criada do HEAD `458108397a4a2bba253283f26b8d9daee462e56c` do #135
(`fix/gate-fin-02-migration-052`), em PR Draft **empilhado** sobre o #135 (#136). O #134 e o #135 não foram
tocados.

**Estado: implementada e testada LOCALMENTE e na CI. NÃO aplicada em HML nem em Production.**

## Problema (CP-10, SQL 090 I5) e diagnóstico corrigido

Com entrada e saída preenchidas, `break_minutes` maior que a duração bruta zera a jornada: o motor
calcula `greatest(0, fim − início − intervalo)` (010/014/036/048/051). A 014 deixou o teto de
propósito para depois ("teto estrutural precisaria de trigger; teto comercial é decisão humana").

**O CP-10 mediu o I5 só com o motor por vigência DESLIGADO** (a SQL 090 desliga o motor na transação e
afirmava que os riscos não dependiam dele). A sessão 19 encontrou, no RED do E2E (motor LIGADO, como
na semente, no HML desde 24/10 e em Production desde 29/10 segundo o ESTADO_DO_PROJETO), que o núcleo
(035) **já recusava** a jornada zerada com `22023 nucleo:zero_minuto_com_horarios: presença com entrada
e saída e nenhum minuto trabalhado`. Logo:

| Motor por vigência | Antes da 053, intervalo > duração                                                       | Com a 053                                                 |
| ------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Desligado          | **gravado**, jornada 0, diária cobrada (SQL 090 I5: `aceito\|0\|1`)                     | recusado, 23514, mensagem da 053                          |
| Ligado             | recusado pelo núcleo, 22023, mensagem técnica que não diz o que corrigir (trace do E2E) | recusado, 23514, mensagem da 053 (dispara antes do motor) |

O motor é um interruptor que o admin alcança (`alterar_motor_vigencia`, reversão da 031): a proteção
não pode depender dele. A 053 continua necessária, mas o risco **atual** em HML/Production (motor
ligado) era de mensagem, não de valor — registrado aqui para não superestimar o defeito.

## Auditoria dos caminhos de gravação em `timesheet_entries`

| Caminho                                                                  | Como grava                                                               | Coberto pela 053                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------- |
| PostgREST direto (`authenticated`, admin pela RLS `*_exige_admin`)       | INSERT/UPDATE/DELETE com grant de tabela                                 | sim (trigger da tabela) — SQL B, C; IJ4 |
| Upsert anterior da tela (`salvarPeloCaminhoAnterior`, bancos sem a 031)  | `upsert` pela chave primária (`ON CONFLICT (id) DO UPDATE`)              | sim — SQL B11                           |
| `salvar_apontamento_admin` (031/032/040, SECURITY INVOKER)               | SELECT, depois INSERT ou UPDATE                                          | sim — SQL E1–E3; IJ1, IJ2               |
| `salvar_apontamento_operacional` (013–016, dona `bslog_rpc_operacional`) | `INSERT … ON CONFLICT (timesheet_id, employee_id) DO UPDATE`             | sim — SQL F1–F3; IJ3                    |
| Tela do admin (`/apontamentos`)                                          | a RPC do admin; mensagem do banco mostrada como está (`mensagemDoErro`)  | sim — IJ1, IJ2                          |
| Tela do operador (`/operacional`)                                        | a RPC do operador; 23514 → "Revise turno, equipe e intervalo"            | sim — IJ3                               |
| Gatilhos financeiros (010 desabilitado, `calculo_vigencia`, snapshots)   | derivam valores no BEFORE; a 053 dispara antes do motor (ordem por nome) | n/a (não gravam intervalo)              |
| Folha fechada (031), faturado (011), entrada = saída (029)               | recusam antes ou depois; independentes                                   | inalterados                             |

Nenhum caminho pula a tabela, então um gatilho BEFORE INSERT OR UPDATE cobre todos, inclusive o
`service_role` e sessões `postgres` (o trigger não tem isenção).

## Casos A–H

| Caso | Situação                              | Antes                                   | Com a 053                                              |
| ---- | ------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| A    | intervalo negativo                    | 23514 (CHECK da 014)                    | inalterado                                             |
| B    | intervalo = duração (jornada 0)       | motor desligado: gravado; ligado: 22023 | **inalterado** (a 053 aceita; não há regra nova)       |
| C    | intervalo > duração (I5)              | motor desligado: gravado; ligado: 22023 | **23514, mensagem da 053**                             |
| D    | virada legítima (22:00→07:00, 60)     | aceito, 480 min                         | inalterado (a duração usa a virada do motor)           |
| E    | turno diurno, entrada antes da saída  | aceito                                  | inalterado                                             |
| F    | saída antes da entrada no diurno (I1) | aceito como virada (08:00→07:50 = 1430) | **inalterado — fora do escopo** (054/058, DEC-CP05-01) |
| G    | ausência (com ou sem horários)        | aceito, sem valor                       | inalterado (a 053 ignora `absent`)                     |
| H    | incompleto (sem entrada ou saída)     | aceito, jornada 0                       | inalterado; ao completar, a 053 confere (SQL B9b)      |

O caso B é ambíguo para a regra comercial (jornada zero com presença) e **não ganhou regra**: com o
motor ligado o núcleo já o recusa; com o motor desligado segue gravado.

## Regra da 053

`supabase/migrations/20261120120000_053_recusar_intervalo_maior_que_jornada.sql`:

- função `public.recusar_intervalo_maior_que_jornada()` (SECURITY DEFINER da `postgres`,
  `search_path` fixo, sem EXECUTE para `PUBLIC`, `anon`, `authenticated`, `service_role` e
  `bslog_rpc_operacional`) e gatilho `trg_timesheet_entries_bloqueia_intervalo_maior` BEFORE INSERT OR
  UPDATE FOR EACH ROW;
- recusa quando `status <> 'absent'`, entrada e saída preenchidas e `break_minutes` > duração bruta
  (hora×60+minuto; saída ≤ entrada soma 1440 — a fórmula do motor);
- 23514, mensagem "O intervalo de N min é maior que o tempo entre a entrada e a saída (M min). Corrija o
  intervalo ou os horários antes de salvar." e dica sobre a virada da meia-noite (sem "violates" nem
  "constraint", então a tela do admin a mostra sem trocar pela genérica);
- UPDATE só revalida quando status, entrada, saída ou intervalo mudam (histórico: observação, vínculo
  de fatura e leitura seguem livres); INSERT de linha que já existe (upsert) fica para o UPDATE do
  `ON CONFLICT` — o padrão da 029;
- autoverificação: catálogo (gatilho, dona, `search_path`, ACL efetiva) e comportamento num gatilho
  sobre tabela **temporária** (oito casos, sem tocar dado real).

**Não muda:** diária, hora extra, custo, domingo/feriado, faturamento, cancelamento, permissões, RLS,
assinaturas de RPC, contratos, migrations 001–052. Sem jornada máxima (DEC-CP05-01, 054/058). Sem
mudança no app.

## Preflight de dados (local)

`supabase/preflight/053_intervalo_maior_que_jornada_preflight.sql`, `READ ONLY` + `rollback`, só
contagens. Rodado **apenas no banco local** do E2E, já com a 053, depois das specs 00–80 (14/11/2026
16:25 UTC): 133 apontamentos, 99 com entrada e saída, **0 violações** (logo 0 faturadas, 0 em folha
aberta ou fechada, 0 fixas ou avulsas, 0 virando a meia-noite), 0 no limite exato, 0 ausências com
intervalo maior, 34 incompletos com intervalo positivo (fora da regra). O RED do E2E sem a 053 também
não gravou violação: com o motor ligado o núcleo já recusava. **Detecção provada:** no banco do runner
SQL, numa transação desfeita, uma linha avulsa 23:00→01:00 com intervalo 300 gravada com o gatilho
desligado foi contada pelo preflight (`total 1`, `operacao_avulsa 1`, `sem_turno 1`, `folha_aberta 1`,
`virando_a_meia_noite 1`, `maior_excesso_min 180`).

**HML e Production:** o preflight precisa rodar lá, cada um com autorização própria e o transporte de
leitura autorizado naquele gate, antes de aplicar a 053. Violações existentes não impedem a aplicação
(o gatilho não revalida o que não mudou), mas seguem com jornada 0 e diária cobrada e exigem decisão do
responsável — este gate não corrige dado.

## RED (antes da 053)

- **SQL 053 (nova):** 19 de 31 casos falham (A1–A3, B1, B1b, B2 em cascata do B1, B7, B9b, B10, B11,
  C1–C4, D3, E1, E3, F1, F3). Ex.: B1 `aceito|1`; E1 a RPC do admin gravou (`gravadas: 2`); F1 a RPC do
  operador gravou; F3 `09:00:00|61`. Os 12 casos válidos (B3–B6, B8, B9, D1, D2, D4, E2, F2, G1) já
  passavam — são o controle.
- **SQL 090:** só o I5 falha — `esperado erro 23514|0, obtido aceito|0|1` (gravado com jornada 0).
  Todos os outros 45 casos inalterados.
- **E2E (spec 80, motor ligado):** IJ1, IJ2 e IJ3 falham porque a recusa vem do núcleo (22023, "nenhum
  minuto trabalhado"), não da regra explícita; IJ4 falha em cascata (o IJ1 não gravou a Bia). O trace
  do IJ1 mostrou a resposta `{"code":"22023","message":"nucleo:zero_minuto_com_horarios: …"}` — a origem
  do diagnóstico corrigido acima.

Inventários que a 053 muda de propósito (não são regra): SQL 010 I1 (lista exata de gatilhos), 018 V4
e 019 V4 (contagens que excluem gatilhos posteriores), spec 00 e `test:configuracoes`,
`test:motor-vigencia`, `test:interfaces-vigencia`, `test:regras-definitivas` (58 migrations, cabeça
053).

## GREEN (com a 053)

| Prova                                | Evidência                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| INSERT inválido (API direta)         | SQL B1 (`erro 23514\|0`), B1b (mensagem e dica), B7 (virada), B10 (várias linhas); IJ4                     |
| UPDATE inválido                      | SQL C1 (541 em 540), C2 (saída encolhida), C3 (linha intacta), B9b (completar a saída); IJ4                |
| Upsert pela chave (caminho anterior) | SQL B11                                                                                                    |
| RPC do admin                         | SQL E1 (nada gravado, nem a folha), E3 (edição recusada); IJ1, IJ2 na tela                                 |
| RPC do operador                      | SQL F1 (nada gravado), F3 (`ON CONFLICT DO UPDATE` recusado, linha intacta); IJ3                           |
| Limite exato                         | SQL B2, B6, E2, F2 (aceitos com o motor desligado); IJ1 (motor ligado: o núcleo recusa, como antes)        |
| Jornada noturna                      | SQL B5 (480), B6, B7; IJ2 (22:00→07:00 = 480 min, R$ 240 / R$ 160)                                         |
| Ausência e incompleto                | SQL B8, B9                                                                                                 |
| Valores financeiros preservados      | SQL B4 (`480\|0\|200.00\|120.00`), C4 (510); spec 80 inteira ao centavo; IN1                               |
| Histórico não travado                | SQL D1–D4 (observação livre, valores iguais, correção para valor válido) e G1 (fatura sai com o histórico) |
| Catálogo                             | SQL A1–A3; 090 S1/S2 (DEFINER com `search_path`, nenhuma executável por `anon`/`PUBLIC`)                   |

**SQL 090:** **33 SEGURO e 13 RISCO** (era 32/14): a única mudança de classificação é o I5. **I1 e I7
seguem RISCO** (`aceito|1430`; `1|17:00:00`).

**Ensaio do rollback (local):** o runbook removeu gatilho e função; a suíte 053 voltou a 19 falhas e o
090 I5 a falhar, de propósito; `schema_migrations` intacto (58, cabeça 053); reaplicar a 053 duas vezes
foi idempotente e a suíte voltou a 31/31.

## Regressão completa (com a 053)

| Verificação                                                             | Resultado                                                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run e2e:local`                                                     | **242 testes · 241 PASS · 0 FAIL · 1 FALHA CONHECIDA (CN-D) · 0 PULADO** · 1716 s · nenhuma rede externa (238 de antes + IJ1–IJ4) |
| SQL local                                                               | 54 suítes PASS (053 nova: 31/31; 090: 33 SEGURO, 13 RISCO)                                                                        |
| `test:*`                                                                | 82/82 (inventário de migrations atualizado em 4 suítes; `test:legado-local` 13/13 com o rollback da 052 corrigido)                |
| lint · `tsc` · Prettier · `check:workflow` · `git diff --check` · build | PASS (Prettier: só os três Markdown que já estavam fora do padrão antes — PROGRESS, TESTES_E2E, HANDOFF — seguem como estavam)    |
| travas                                                                  | 25/25                                                                                                                             |

A 1ª execução completa do E2E falhou da spec 90 em diante (login em vez do painel): o IJ4 novo encerrava
a sessão da API com `signOut()`, cujo escopo padrão é global e derrubou a sessão do admin usada pelas
specs seguintes. Defeito do teste, não da 053: corrigido para `signOut({ scope: "local" })`, como as
demais specs, e o E2E completo repetido (resultado acima). Nenhum teste removido, pulado ou
reclassificado.

## Impacto financeiro (esperado × observado)

| Esperado                                                                                     | Observado                                                                                                      |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| nenhum valor válido muda                                                                     | SQL B4/B5/C4 e 010 E1/E2 iguais; spec 80 (cálculo independente) e IN1 ao centavo; specs 10, 95, 97 sem mudança |
| nenhum faturado muda                                                                         | SQL D2 e G1; 090 F8/F9                                                                                         |
| apontamentos que antes saíam com jornada 0 e diária (motor desligado) deixam de ser gravados | SQL 090 I5 e 053 B1/B7/E1/F1                                                                                   |

## Rollback e compatibilidade

`docs/runbooks/rollback-recusar-intervalo-maior-que-jornada.sql`: `DROP` do gatilho e da função, com
verificação. **Reabre o I5.** Não apaga o registro da 053 em `schema_migrations`: o histórico aplicado
é preservado e a reversão é registrada como operação distinta. Revalidar: SQL 053 e 090 I5 e spec 80
IJ1–IJ4 passam a falhar, de propósito.

Compatibilidade remota (quando autorizada): o app do #134/#135 não muda; no site `ecd67f2` a tela do
admin passa a mostrar a mensagem da 053 em vez da do núcleo; a do operador, a explicação do 23514 em
vez da do 22023.

## Correções documentais herdadas da 052 (sem mudar o comportamento dela)

- **A.** O HEAD validado da sessão 18 é `458108397a4a2bba253283f26b8d9daee462e56c` (HANDOFF, tarefa
  anterior, com os links da CI).
- **B.** O rollback da 052 não sugere mais apagar o registro em
  `supabase_migrations.schema_migrations`: o histórico é preservado e a devolução do privilégio é
  registrada como operação distinta (runbook e índice). `test:legado-local` E3 segue verde.
- **C.** A 052 encerra a criação direta pela RPC antiga, mas `corrigir_servico_container` continua
  podendo criar um substituto de registro histórico: o caminho legado não foi integralmente eliminado
  (PROGRESS e HANDOFF).

## Riscos que permanecem

- **I1** (AUT-CP05-01): saída antes da entrada em turno diurno vira jornada de 23h50 — a duração bruta
  de 08:00→07:50 é 1430, e a 053 não a toca. Decisão de jornada máxima: DEC-CP05-01 (054/058).
- **I7**: versão obsoleta sobrescreve sem erro (sem controle de versão no banco).
- Violações históricas em HML/Production: não contadas (preflight remoto não autorizado).
- O teto do intervalo do **turno** (`shifts`) não faz parte da 053 (a tela já recusa, D-CP04-03).
- Seguem os riscos do 090: AUT-CP07-01, DEC-CP06-04, DEC-CP07-03, DEC-CP02-01, F2/F4/F7/F11/F12,
  D3–D5, K1. O `postgres` local é superusuário; em Production não é — a conferência de ACL e dono no
  ambiente remoto faz parte do gate de aplicação.

## Próximo gate (não autorizado)

Aplicar a 053 no HML exige autorização nominal (antes: backup, preflight e conferência de catálogo por
leitura autorizada); Production, outra. 054/058 e CP-11/CP-12 não foram iniciados.
