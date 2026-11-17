# Gate C — D1: vigência do contrato (migration 055, sessão 35)

Implementação **só local** (sem commit, push, PR, deploy nem aplicação remota), a partir do HEAD
`3bac8afa737925615752014bfbd12451bce400be` (#139, D8), na branch local `fix/gate-c-d1-vigencia-contrato`.

## Regra (decisão do responsável, 16/11/2026)

- A data de execução do serviço deve estar dentro da vigência do contrato da operação; o fim é
  **inclusivo**; contrato sem fim = vigência aberta.
- Serviço executado dentro da vigência pode ser faturado depois, mesmo após o fim do contrato.
- Lançamento histórico não é alterado nem recalculado; fatura emitida não muda.
- Operação sem contrato segue as regras que já tinha.

## Causa técnica

- **Datas do contrato:** `contracts.valid_from`/`valid_to` não tinham CHECK. A tela conferia (CP-02,
  `clientes/_dominio.ts`: anos 1900–2100, fim ≥ início), mas a gravação direta pela API
  (`useSaveRow("contracts")`, insert/update) e `criar_contrato_com_vigencia` (INVOKER, 038) aceitavam
  fim antes do início e ano 0001 — o contrato TESTE-MANUAL do HML foi gravado assim em 11/11/2026, pela
  tela anterior ao #134.
- **Data de execução:** nada relacionava a data da folha com `contracts.valid_from/valid_to`. O motor
  resolve as **condições** (`contract_terms`, abertas) pela data, mas o fim do contrato não limitava
  nada: um dia depois dele era lançado e cobrado (DEC-CP02-01; SQL 090 K1; E2E CN-D).

## Caminhos de escrita levantados

| Caminho | Grava | Coberto pela 055 |
| --- | --- | --- |
| PostgREST direto (`useSaveRow("contracts")`), seed | `contracts` | CHECK `contracts_vigencia_valida` |
| `criar_contrato_com_vigencia` (INVOKER) | `contracts` + `contract_terms` | CHECK (a vigência inicial cai junto, mesma transação) |
| `salvar_apontamento_admin` (v1) e `salvar_apontamento_admin_v2` | `timesheets` + `timesheet_entries` | gatilho; a chamada inteira é desfeita |
| `salvar_apontamento_operacional` (v1) e `_v2` (dona `bslog_rpc_operacional`) | idem | gatilho (DEFINER da `postgres`: o operador não ganhou nenhum grant) |
| PostgREST direto em `timesheet_entries` (insert, upsert, update) | `timesheet_entries` | gatilho |
| Mover uma folha (`timesheets.work_date`/`operation_id`) | repassa a chave aos apontamentos (008) | gatilho, pelo UPDATE em cascata |
| `gerar_fatura` (vínculo `invoice_id`) | `timesheet_entries` | **não revalida** (faturamento posterior permitido) |
| Adicionais (`registrar_adicional`, por período) e contêiner legado (`corrigir_servico_container`) | `billing_additionals`, `container_services` | **fora do escopo** — decisão pendente (abaixo) |

## Migration 055 (`20261122120000_055_vigencia_do_contrato.sql`)

1. `contracts_vigencia_valida` — CHECK **NOT VALID**: início e fim entre 1900-01-01 e 2100-12-31 e
   fim ≥ início. NOT VALID não confere as linhas existentes: o registro antigo inválido fica como está;
   toda gravação nova (inclusão ou edição de qualquer coluna da linha) precisa cumprir a regra.
2. `recusar_execucao_fora_da_vigencia()` (SECURITY DEFINER da `postgres`, `search_path` fixo, sem
   EXECUTE para ninguém) e o gatilho `trg_timesheet_entries_bloqueia_fora_da_vigencia` (BEFORE INSERT OR
   UPDATE): recusa com **23514**, detalhe `vigencia_do_contrato`, apontamento de serviço (status ≠
   `absent`) cuja folha está fora da vigência do contrato da operação. A data e a operação vêm da folha.
   Num UPDATE só revalida quando muda o que decide a cobrança do dia (folha, colaborador, status,
   horários, intervalo ou a chave data/operação); observação, vínculo de fatura e versão seguem livres.
   Contrato com fim antes do início: nenhuma data passa, com mensagem própria.
3. Envelope `begin;`/`commit;` (executor remoto), autoverificação de catálogo; nenhuma linha lida para
   alterar nem escrita; sem isenção por papel (`postgres` incluído), sessão ou variável.

Mensagens: admin — a do banco ("A data 22/10/2026 está fora da vigência do contrato desta operação
(de 01/10/2026 até 20/10/2026). …"); operador — texto fixo pelo detalhe `vigencia_do_contrato`
(`operacional/_dominio.ts`), sem contrato nem datas. Também: preflight só de leitura
(`supabase/preflight/055_vigencia_do_contrato_preflight.sql`) e reversão
(`docs/runbooks/rollback-vigencia-do-contrato.sql`).

## Testes

- **`supabase/tests/055_vigencia_do_contrato.sql`** (44 casos): catálogo; contrato válido, sem fim, fim
  antes do início, mesmo dia, anos 0001 e 2101, pela API e pela RPC, alteração de existente; execução
  antes do início, no primeiro e no último dia, depois do fim, mensagem, ausência, contrato aberto,
  operação sem contrato; as quatro RPCs (fora recusado e atômico, dentro aceito); histórico fora da
  vigência preservado e editável na observação, recusado na jornada; mover folha; encurtar vigência
  não mexe no lançado; faturamento posterior e imutabilidade; contrato antigo com fim 0001.
  **RED** (banco na 054): 23 de 44 falham. **GREEN**: 44/44.
- **`npm run test:d1-vigencia-contrato`** (19): mensagem do operador e do admin, limites de ano da tela
  = CHECK, forma da migration. **RED** (domínio do operador original): A1 falha. **GREEN**: 19/19.
- **E2E spec 50 CN-D** reescrito: o último dia (20/10) é lançado e cobrado; 22/10 é recusado na tela,
  com a mensagem do banco, e nada é gravado. Deixou de ser `@falha-conhecida`.
- **SQL 090 K1**: RISCO → SEGURO (o dia depois do fim é recusado). 090 passa a 34 SEGURO e 12 RISCO.
- **Regressão local**: SQL do zero 56 suítes PASS; atomicidade 053 17/17; concorrência 46/46; Node
  87/87 `test:*`; lint, `tsc --noEmit`, `check:workflow` e build PASS; E2E completo 265 testes, 265
  PASS, 0 FAIL, 0 FALHA CONHECIDA, 0 PULADO.

### Fixtures ajustadas (compatibilidade)

26 suítes SQL criavam contrato **sem** `valid_from` (o default é `CURRENT_DATE`) e lançavam datas
passadas: com a regra, esses lançamentos ficam fora da vigência. Só esses inserts ganharam
`valid_from = 2000-01-01` (nenhuma asserção mudou): 007, 014, 016, 017, 018, 019, 020, 021, 022, 024,
025, 027, 028, 029, 030, 036 (e o gerador `scripts/gerar-sql-integracao-v2.mjs`), 037, 039, 040, 041,
042, 043 (dias especiais e revisão independente), 044, 048, 051. Inventários atualizados como nas 053 e
054: gatilhos (SQL 010 I1, 018 V4, 019 V4), migrations (`test:configuracoes`, `test:motor-vigencia`,
`test:interfaces-vigencia`, `test:regras-definitivas`, spec 00: 60 migrations, head 055).

## Efeito sobre os registros existentes (demonstrado localmente)

Os dados de `public` do backup cifrado do HML (sessão 27, idêntico ao HML atual pela sessão 29) foram
restaurados num Supabase **local** descartável na 054; Auth não foi restaurado. Preflight antes e
depois da 055, com as **mesmas** contagens:

- contratos: 2 (1 sem fim); **1 com fim antes do início e ano fora de 1900–2100** (TESTE-MANUAL);
- apontamentos: 5; **2 de serviço fora da vigência, nenhum faturado** (os do TESTE-MANUAL em 11/11);
- adicionais e serviços de contêiner fora da vigência: 0.

As 31 tabelas de `public` com md5 **idêntico** antes e depois de aplicar a 055 (nada alterado). Numa
transação desfeita sobre esses dados: novo lançamento na operação do TESTE-MANUAL **recusado** com a
mensagem do contrato inválido; renomear o contrato sem corrigir as datas **recusado** (23514 do CHECK);
editar a observação de um lançamento antigo **aceito**; alterar a jornada dele **recusado**.

## Registro 01/01/0001 (TESTE-MANUAL) — decisão pendente

A 055 não o altera. Enquanto ele existir assim: a operação dele não aceita lançamento novo; o contrato
não pode ser editado sem corrigir as datas; os 2 lançamentos dele (11/11, não faturados) ficam como
estão e podem ser faturados ou excluídos como antes. Opções, todas com escrita autorizada no HML:

1. **Corrigir o fim para vazio (vigência aberta)** — os 2 lançamentos voltam a ficar dentro da
   vigência; é o que a tela faria ao editar o contrato sem fim.
2. **Corrigir para a data real de fim**, se houver.
3. **Encerrar os dados de teste** (o contrato é sintético) na limpeza de entrega.

Depois de corrigido, `validate constraint contracts_vigencia_valida` pode virar migration própria.

## Decisões pendentes e riscos

- **Adicionais** (`billing_additionals`, por período, operação opcional) e **contêiner legado**
  (`executed_on`, só a correção aberta): a regra aprovada não define a "data de execução" deles; não
  foram restringidos.
- **Alterar a vigência do contrato ou o contrato da operação** não revalida o já lançado (histórico
  intocado); só novas gravações e edições de jornada passam pela regra.
- **Lançamentos antigos fora da vigência e não faturados** continuam faturáveis como estavam: excluir,
  marcar falta ou faturar é decisão do responsável (no HML, os 2 do TESTE-MANUAL).
- **Fixtures e contratos com início = data de criação**: contrato cadastrado com início posterior à data
  dos serviços que se quer lançar passa a recusar o lançamento — é a regra, mas pode surpreender no
  piloto; a tela mostra a mensagem do banco.
- **Compatibilidade de app**: o site atual de Production (`ecd67f2`) e o app do #134–#139 mostram a
  mensagem do banco ao admin; o operador do app antigo vê o texto genérico do 23514.
- Ordem de publicação: banco (055) antes ou junto do app; nada disso foi autorizado. Roteiro do gate de
  aplicação no HML: [hml-055-vigencia-do-contrato.md](../runbooks/hml-055-vigencia-do-contrato.md).
