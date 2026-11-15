# GATE-FIN-05 — Migration 054: versão dos apontamentos, contratos v2 e confirmação de virada (EXPANDIR)

Sessão 22 (15/11/2026, sessão em nuvem, Linux, Supabase local descartável). Branch
`fix/gate-fin-05-migration-054`, criada do HEAD `43991da3e3e2ebd16ca9c33c22ca30cde13c84a6` do #136
(`fix/gate-fin-03-migration-053`, sessão 21 concluída e validada nele), em PR Draft **empilhado** sobre
o #136. O #134, o #135 e o #136 não foram tocados.

**Estado: implementada e testada LOCALMENTE e na CI. NÃO aplicada em HML nem em Production.**

A 054 é **expansão**: prepara a correção do I1 (jornada impossível lida como virada da meia-noite) e
do I7 (gravação concorrente que sobrescreve sem aviso), mas **não** os resolve globalmente. O legado
(RPCs v1, upsert antigo, escrita direta) continua gravando sem versão e sem confirmação: **I1 e I7
seguem RISCO** na SQL 090 (33 SEGURO, 13 RISCO, inalterada). A exigência global é da 058.

## Requisitos de partida (sessão 20, análise só de leitura, sem arquivo próprio)

Recuperados das seções 4 e 5 da autorização desta sessão: confirmação excepcional de virada só pelo
admin, verificada no banco e auditada, invalidada quando o confirmado muda, sem bloquear o legado;
mínimo de grants por coluna para o operador, nada financeiro, nenhuma isenção por papel ou variável;
DELETE do admin mantido (revogação na 058); retentativa idêntica idempotente, versão obsoleta com
conteúdo diferente = conflito explícito, sem subir versão à toa; sem limite de jornada (DEC-CP05-01);
jornada zero como está.

## Diagnóstico dos escritores de `timesheet_entries`

| Escritor                                                                                                                | Identidade                                           | Grants usados          | Escreve                         | Folha fechada                      | Faturado           | Efeito da 054                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------- | ------------------------------- | ---------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| PostgREST direto (admin)                                                                                                | `authenticated` (RLS: staff + `*_exige_admin` + MFA) | tabela inteira (I/U/D) | qualquer coluna não derivada    | 031 recusa (55000)                 | 011 recusa (42501) | a versão sobe sozinha; **sem conferência** (058); DELETE mantido              |
| Upsert antigo da tela (`salvarPeloCaminhoAnterior`, `ON CONFLICT (id)`)                                                 | `authenticated`                                      | tabela inteira         | 10 colunas da carga             | 031                                | 011                | idem; o cliente não escolhe a versão                                          |
| `salvar_apontamento_admin` (v1)                                                                                         | `authenticated` (INVOKER)                            | tabela inteira         | 5 + folha                       | 55000                              | 011                | **intacta** (md5); versão sobe sozinha                                        |
| `salvar_apontamento_operacional` (v1, `ON CONFLICT`)                                                                    | `bslog_rpc_operacional` (DEFINER)                    | por coluna (55)        | 5–7 colunas                     | 42501                              | 42501              | **intacta**; versão sobe sozinha; inclusão simultânea ainda sobrescreve (058) |
| `salvar_apontamento_admin_v2` (novo)                                                                                    | `authenticated` (INVOKER)                            | tabela inteira         | 5 + folha                       | 55000                              | 42501              | versão obrigatória, conferida sob `FOR UPDATE`                                |
| `salvar_apontamento_operacional_v2` (novo)                                                                              | `bslog_rpc_operacional` (DEFINER)                    | por coluna (56)        | 5–7 colunas                     | 42501                              | 42501              | idem; sem `ON CONFLICT`                                                       |
| `gerar_fatura`                                                                                                          | `postgres` (DEFINER)                                 | dono                   | `invoice_id`                    | permitido (031: só o vínculo muda) | —                  | vínculo sobe a versão; nada recalculado                                       |
| `corrigir_snapshots_do_apontamento` (040), `definir_bonus_do_apontamento` (042), `regularizar_apontamento_legado` (025) | `postgres` (DEFINER)                                 | dono                   | snapshots, bônus, regularização | conforme as travas                 | 011                | versão sobe quando muda algo; nada mais                                       |
| `propagar_chave_da_diaria` (008, gatilho de `timesheets`)                                                               | quem altera a folha                                  | —                      | `operation_id`/`work_date`      | —                                  | —                  | versão sobe                                                                   |
| Gatilhos BEFORE da tabela (âncora, travas, motor, snapshots, chave, `updated_at`, 029, 053)                             | invocador / dono                                     | —                      | derivados                       | —                                  | —                  | rodam ANTES do gatilho de versão (ordem real do catálogo, conferida)          |

**`INSERT … ON CONFLICT DO UPDATE`.** O EXCLUDED já reflete os gatilhos BEFORE INSERT e o `DO UPDATE`
só leva as colunas nomeadas no SET: uma "versão esperada" guardada em coluna poderia chegar nula à
conferência (e o operador precisaria de grant de escrita nela). Por isso a 054 **não** usa coluna
transitória: a versão é só do banco, e os contratos v2 comparam sob trava, sem `ON CONFLICT`.

## Arquitetura implementada

`supabase/migrations/20261121120000_054_versao_e_confirmacao_de_virada.sql` (begin/commit explícitos,
autoverificação de catálogo e do gatilho numa tabela temporária):

1. **Versão:** `timesheet_entries.versao bigint not null default 1`; gatilho
   `trg_timesheet_entries_zz_versao` (BEFORE INSERT OR UPDATE, o último da tabela pela ordem real do
   catálogo): INSERT = 1; UPDATE com mudança efetiva em qualquer coluna (exceto `updated_at`) = +1;
   sem mudança = mesma versão; o valor enviado pelo cliente é ignorado. Monotônica pelo banco.
2. **Contratos v2** com `versao_esperada` obrigatória por linha (0 = nova): `salvar_apontamento_admin_v2`
   (INVOKER, guardas da v1, chave desconhecida = 22023, aceita `confirmar_virada` e `job_function_id`),
   `salvar_apontamento_operacional_v2` e `listar_apontamentos_do_operador_v2` (DEFINER da
   `bslog_rpc_operacional`, guardas da v1 na mesma ordem, seis chaves da v1 + `versao_esperada`).
3. **Regra de versão (atômica):** a linha é travada (`FOR UPDATE`) antes de comparar; linhas
   processadas em ordem de colaborador (sem deadlock entre lotes). Versão certa → `atualizado`; versão
   obsoleta e conteúdo diferente → **40001**, nada gravado; conteúdo idêntico ao gravado →
   `sem_alteracao`, **sem subir a versão** (retentativa depois de resposta perdida). Linha nova com
   versão > 0 → 40001; inclusão simultânea → o índice único espera o outro, e a decisão é a mesma regra
   sobre a linha dele.
4. **Confirmação de virada:** `confirmar_virada_do_apontamento(entry, versao)` (DEFINER da `postgres`,
   que só escreve na trilha): só admin com MFA em dia; versão conferida sob trava; só para
   `pendente` (virada fora de turno que vira o dia); idempotente. Trilha
   `apontamento_confirmacoes_virada`: quem, quando, horários, folha, turno (início, fim, se vira o dia)
   e versão. **Invalidação** registrada (nunca apagada) quando horário, status, folha ou colaborador
   mudam, ou o apontamento é excluído; mudar a jornada do turno também tira o valor da confirmação.
   `situacao_da_virada(entry)`: `sem_virada | turno_vira_o_dia | confirmada | pendente` (só admin).
5. **Trilha protegida:** RLS ligada; leitura só do admin com MFA; nenhum INSERT/UPDATE/DELETE/TRUNCATE
   para `anon`, `authenticated`, `service_role` ou o operador; gatilho que só aceita a invalidação e
   recusa alterar o confirmado ou apagar, **também para a dona** (55000).

## Permissões e dono

| Papel                                                           | O que a 054 acrescenta                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bslog_rpc_operacional`                                         | **só** `SELECT(versao)` em `timesheet_entries` (55 → 56 grants por coluna; nenhum de tabela; nada financeiro; `CREATE` no schema concedido e revogado na mesma transação para a troca de dono das duas v2, como na 013) |
| `authenticated`                                                 | EXECUTE nas 5 funções públicas novas; SELECT na trilha (RLS: só admin)                                                                                                                                                  |
| `anon`, `service_role`, `PUBLIC`                                | nada (revogado explicitamente)                                                                                                                                                                                          |
| Funções internas (versão, invalidação, proteção, classificação) | ninguém executa                                                                                                                                                                                                         |

Sem isenção por `current_user`, `session_user`, `current_setting` ou `service_role`
(`test:migration-054` C1–C3). A RLS e os grants das tabelas existentes não mudaram. Nenhuma função
exige AAL2: o piso continua `mfa_cotidiano_ok()`.

## RED (antes da 054)

Demonstrado no `43991da` (sem a 054) com as versões finais dos testes, num worktree temporário:

| Teste                           | RED                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `test:migration-054` (estático) | 9 falhas (arquivo inexistente)                                                                                                           |
| SQL 054 (nova)                  | 58 de 61 divergem; passam só os 3 controles (A7: legado intacto, F4: legado sobrescreve, G2: a fatura sai); as 54 suítes anteriores PASS |
| Concorrência real               | 0 de 46 (os contratos v2 não existem: 42883)                                                                                             |

## GREEN (com a 054)

| Teste                                                                  | GREEN                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `test:migration-054`                                                   | 16/16                                                                                           |
| SQL 054                                                                | **61/61**: 58 casos da 054 + 3 registros do legado que só a 058 recusará (E1, F4, F5)           |
| Concorrência real (`scripts/testar-concorrencia-apontamento-local.py`) | **46/46**, três vezes seguidas (determinística)                                                 |
| SQL do zero (`db reset`)                                               | **55 suítes PASS** (54 + a 054); 053 31/31; **090: 33 SEGURO, 13 RISCO** (I1 e I7 seguem RISCO) |
| Atomicidade da 053                                                     | 17/17 (com a 054 por cima)                                                                      |

**Separação 054 × 058 na suíte:** os casos marcados `058` registram o comportamento ATUAL do legado
(virada no diurno sem confirmação gravada pela v1 e pela v2; escrita direta sem versão sobrescreve),
para a CI acusar quando a 058 mudar. Nenhum risco da SQL 090 foi convertido em SEGURO.

## Concorrência real (duas conexões PostgreSQL)

Duas sessões `psql` independentes (A e B) e uma observadora (O). A intercalação é controlada: O espera
em `pg_stat_activity` até B estar **bloqueada por lock** antes de A confirmar. O resultado de cada
comando vem da variável `:SQLSTATE` do psql (ordem determinística). Diferente do E2E com duas abas, que
prova a tela, não o isolamento entre transações.

| Cenário                        | Prova                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 admin × admin (sequencial)  | versão obsoleta com outro conteúdo = 40001; vale a gravação de A                                                                                           |
| S2 admin × admin (intercalado) | B bloqueada no lock de A; A confirma; B recebe 40001; vale A                                                                                               |
| S3 operador × operador         | idem pela v2 do operador                                                                                                                                   |
| S4 admin × operador            | idem                                                                                                                                                       |
| S5 PostgREST × RPC             | a escrita direta **sem versão ainda sobrescreve** (legado, 058), mas a versão sobe e o v2 seguinte recebe 40001                                            |
| S6 inclusão simultânea         | B espera o índice único; conteúdo diferente = 40001 sem segunda linha; idêntico = `sem_alteracao`                                                          |
| S7 resposta perdida            | repetição idêntica = `sem_alteracao` sem subir a versão (admin e operador); diferente = 40001                                                              |
| S8 fechamento × gravação       | fechar espera a gravação; gravar depois de fechado = 55000 (admin) / 42501 (operador); na ordem inversa o operador espera o fechamento e é recusado        |
| S9 fatura × gravação           | a emissão espera a gravação; sai com o valor confirmado, ao centavo (R$ 475,00 = 275,00 + 200,00); vínculo sobe a versão; faturado imutável também pelo v2 |

Na CI roda por último no job `sql-local` (grava fixtures confirmadas, inclusive faturadas, no banco
descartável; as suítes que contam linhas globais, como a 009 e a 010, não rodam depois dela).

## Compatibilidade

- **Site de Production `ecd67f2`:** usa `salvar_apontamento_admin` (v1), o upsert `ON CONFLICT (id)`
  de reserva, `timesheets` (criar, fechar e reabrir), `gerar_fatura` e as RPCs v1 do operador. Todas
  intactas (md5 conferido, SQL 054 A7) e exercitadas com a 054: F1 (payload da v1 como o `ecd67f2`
  envia), F2 (operador v1), F3 (upsert), F4 (escrita direta), S8 (fechamento), G2/S9 (fatura). Leituras
  com colunas explícitas não veem a coluna nova; `select *` só ganha um campo.
- **App dos #134–#136:** sem nenhuma mudança de frontend nesta sessão; o E2E completo roda contra o
  banco com a 054 (abaixo).
- Nenhuma RPC removida; nenhuma assinatura alterada; as v2 coexistem com as v1.
- **Dependências da 058 (não implementadas aqui):** versão obrigatória no legado e revogação da
  escrita direta (o DELETE do admin inclusive) e do EXECUTE das v1; confirmação obrigatória da virada;
  limite de jornada (DEC-CP05-01); o app novo publicado e validado em todos os ambientes antes.

## Regressão completa (local, com a 054)

| Verificação                                                           | Resultado                                                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| SQL do zero (`scripts/testar-sql-local.sh`)                           | 55 suítes PASS; 053 31/31; 054 61/61; 090 33 SEGURO / 13 RISCO (inalterada)                                           |
| Atomicidade da 053                                                    | 17/17 com a 054 aplicada                                                                                              |
| Concorrência real (duas conexões)                                     | 46/46, três execuções                                                                                                 |
| E2E completo (`npm run e2e:local`)                                    | 242 testes · 241 PASS · 0 FAIL · 1 FALHA CONHECIDA · 0 PULADO · 1681 s; nenhuma conexão externa tentada pelo servidor |
| `test:*`                                                              | 84/84 (83 anteriores + `test:migration-054` 16/16)                                                                    |
| Travas (`e2e/guarda/testar-guardas.mjs`)                              | 25/25                                                                                                                 |
| `lint`, `tsc --noEmit`, `build`, `check:workflow`, `git diff --check` | sem erro                                                                                                              |

Duas atualizações de inventário apareceram só na regressão completa e foram corrigidas sem afrouxar
nada: a spec 99 M3 passou a listar as 2 RPCs v2 do operador entre as que recusam o admin pelo papel
(42501, comportamento correto), e o gerador `scripts/gerar-sql-integracao-v2.mjs` recebeu a mesma
exclusão de `versao` do teste 036 X19 (`test:integracao-isolamento` S1 exige que o SQL seja a saída
do gerador).

## Valores financeiros (esperado × observado)

| Esperado                 | Observado                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nenhum valor válido muda | SQL 054 C11: mesmos horários pela v1 e pela v2 = 570 min, 90 de HE, R$ 256,25 / R$ 142,50, idênticos; G5: 8 h = R$ 200,00 / R$ 120,00; spec 80 (cálculo independente), IN1 e specs 95/97 ao centavo                       |
| fatura igual             | SQL 054 G2: total = Σ dos valores de antes, inclusive sobre folha fechada; G3: só a versão sobe; S9: R$ 475,00                                                                                                            |
| nada recalculado         | os testes de comparação de linha inteira (018 T1, 019 T2, 036 X19, 043 R3b, 045) continuam conferindo todas as colunas financeiras; só passaram a tratar `versao` como metadado da escrita, como já tratavam `updated_at` |

## Inventários atualizados (não são regra)

SQL 010 (F3: 32 tabelas com RLS; I1: 20 gatilhos), 013 C5 (7 RPCs do operador), 015 H-F1–F7 (88
policies, 43/45, a policy da trilha no inventário exato), 018 V4 e 019 V4 (gatilhos da 054 fora da
contagem histórica), 090 S6 (o admin é recusado pelo papel nas 7 RPCs do operador); comparações de
linha inteira com `versao` como metadado (018 T1, 019 T2, 036 X19, 043 R3b, 045); spec 00 (59
migrations, cabeça 054); `test:configuracoes`, `test:motor-vigencia`, `test:interfaces-vigencia`,
`test:regras-definitivas`. Duas falhas reais da migration foram achadas e corrigidas na própria sessão:
a RPC do admin chamava a classificação interna (não executável por `authenticated`; corrigido para
`situacao_da_virada`) e a policy da trilha chamava `has_role()` por linha (015 H-F8; corrigido para
`(select …)`).

## Preflight e rollback

- **Preflight** `supabase/preflight/054_versao_e_virada_preflight.sql` (`READ ONLY`, só contagens;
  serve antes e depois da 054): apontamentos, versões inicializadas, viradas por tipo de turno e
  faturadas, as que exigiriam confirmação na 058, confirmações válidas e invalidadas, jornada zero,
  presença incompleta, turnos com intervalo inválido e um histograma **neutro** de duração (insumo do
  DEC-CP05-01, não é regra). Executado **só no banco local do E2E** (populado pelas specs, com a
  054, código de saída 0, nada gravado): 137 apontamentos (118 em versão 1, 19 acima, 0 sem versão);
  12 viradas (9 em turno que vira o dia, 3 em turno diurno, 0 sem turno, 1 faturada), 3 exigiriam
  confirmação na 058; 0 confirmações; 0 jornada zero, 0 presença incompleta, 0 turno com intervalo
  inválido; histograma até 8 h 13, 8–10 h 84, 10–12 h 3, 12–20 h 0, acima de 20 h 3. Números de
  fixtures sintéticas, não de HML nem de Production.
- **Rollback** `docs/runbooks/rollback-versao-e-confirmacao-de-virada.sql`: remove funções e gatilhos
  da 054 e o `SELECT(versao)` do operador; **preserva** a coluna `versao` e a trilha (com a proteção);
  não apaga `schema_migrations`. Ensaiado localmente: contagem, soma das versões e md5 dos valores e
  vínculos de fatura idênticos antes e depois; as suítes até a 053 e a 090 passam sem a 054; a suíte
  054 e a concorrência falham, de propósito; **reaplicar a 054 depois do rollback** devolveu tudo verde
  (dados idênticos).

## Riscos que permanecem

- **I1 e I7 (RISCO):** o legado grava sem versão e sem confirmação até a 058; a escrita direta e a
  inclusão simultânea pela v1 do operador ainda sobrescrevem.
- **DEC-CP05-01** (limite de jornada), **jornada zero** e presença sem horário: decisões abertas.
- A confirmação do turno que muda de jornada perde valor por comparação (sem registro de
  invalidação na trilha, que só registra mudança do apontamento).
- O `postgres` local é superusuário; a troca de dono das v2 e o rollback que as remove dependem do
  mesmo vínculo de papel que permitiu a 013 em Production — conferir no gate remoto.
- Seguem os riscos da SQL 090: AUT-CP07-01, DEC-CP06-04, DEC-CP07-03, DEC-CP02-01.

## Próximo gate (não autorizado)

Aplicar 052, 053 e 054 no HML (autorização nominal; antes: backup, preflights e conferência de
catálogo por leitura autorizada); depois, o aplicativo usando os contratos v2; só então a 058, com a
decisão de jornada. Nada disso foi iniciado.
