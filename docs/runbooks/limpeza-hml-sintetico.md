# Limpeza dos dados sintéticos do HML — runbook e ensaio

SDLC: Manutenção / Preparação de homologação. **Este documento é um plano. Nada foi executado no
HML.** A versão para a **050** (10/11/2026) ainda **não foi ensaiada** (seção 6: BLOQUEADO). A
execução exige ensaio local com 0 FAIL e autorização nominal (seção 8). Estado factual:
[HANDOFF](../HANDOFF.md). Condições comuns de runbooks: [índice](README.md).

Objetivo: deixar o HML (`qbnfcmrxmssnwkhaitgd`) sem dados de negócio sintéticos para uma
homologação funcional do zero, **preservando** esquema, RLS, grants, funções, gatilhos (e seus
estados), Auth, perfis, papéis, histórico de migrations e configurações financeiras (motor e
resolução de tarifas). Não cria projeto Supabase nem altera Production.

Artefatos:

| Arquivo                                                                                | Função                                                                                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [limpeza-hml-sintetico.sql](limpeza-hml-sintetico.sql)                                 | Expurgo em uma transação, fail-closed. **Modo padrão `NAO`: ensaio a seco que não altera dado.** Versão 050.           |
| [hml-impressao-digital.sql](hml-impressao-digital.sql)                                 | Só leitura. JSON com migrations, contagens, Auth e hashes do catálogo, para comparar estados. Não depende da versão.   |
| [../../scripts/hml-restaurar-local.sh](../../scripts/hml-restaurar-local.sh)           | Restaura o backup cifrado num Supabase **local** isolado. Recusa destino que não esteja vazio. Exige macOS (Chaveiro). |
| [../../scripts/hml-limpeza-ensaio-local.sh](../../scripts/hml-limpeza-ensaio-local.sh) | Ensaio completo na cópia local: restauração limpa, a seco, testes negativos, execução real, reexecução. Versão 050.    |

## 1. Inventário do HML na 050 (10/11/2026, somente leitura)

Leitura por `GET` no PostgREST com a sessão do administrador real (RLS de admin, AAL1 sem MFA), a
partir do app local ligado ao HML. **Não** foi lido o catálogo (`pg_*`, `supabase_migrations`) nem o
schema `auth`: a raiz OpenAPI do PostgREST exige chave secreta e não há acesso SQL a partir desta
máquina. Essas partes continuam garantidas pelo preflight do script, que aborta se divergirem.

- **Ambiente:** emissor do token `qbnfcmrxmssnwkhaitgd`; `estado_motor_vigencia()` = motor ativo e
  **consistente** (gatilho `trg_timesheet_entries_calculo_vigencia` ligado, legado
  `trg_timesheet_entries_calculo_financeiro` desligado, 4 travas de taxa e jornada ligadas),
  `resolucao_tarifas = false`, `preco_base_recuo = true` (048). Há trilha `corrected` de Containers (049)
  e serviço com pedido no mesmo dia da execução (050): 049 e 050 aplicadas, coerente com o registro
  de 09/11/2026 (HML 050).
- **Assinatura de migrations esperada:** 55 versões, head `20261117120000`, md5 do conjunto
  `01ca91361b85841984ee708716ee60ac`, calculado das versões de `supabase/migrations/` na main
  `3cda0e5`. A mesma regra aplicada às 50 primeiras dá `688388431cd0e6bcc024814fceef8fcd`, que é
  exatamente a assinatura que o HML 045 tinha: o ledger do HML usa as versões do repositório.
- **Tabelas:** as 31 classificadas responderam. Nenhuma migration 046–050 cria tabela (só colunas,
  restrições, funções e gatilhos), então o catálogo segue com 31 tabelas em `public`.
- **Raízes:** 10 clientes e 14 colaboradores, **todos** com prefixo sintético conhecido:

  | Prefixo        | Clientes | Colaboradores | Origem                                                                                   |
  | -------------- | -------- | ------------- | ---------------------------------------------------------------------------------------- |
  | `HML-TESTE`    | 1        | 2             | fixtures de 24/10/2026 (inventário 045)                                                  |
  | `AUTH01C2`     | 3        | 0             | testes de autorização de 30/10/2026 (inventário 045)                                     |
  | `E2E-S11`      | 2        | 5             | homologação FIN-PR-13, sessões 11–14 (inventário 045)                                    |
  | `E2E-S19B`     | 1        | 2             | homologação S19 (inventário 045)                                                         |
  | `HOMOLOG-SINT` | 3        | 5             | homologação de telas de 09–10/11/2026 (`-UI`, `-AV`, `-AV2`), IDs registrados no HANDOFF |

- **Origem por chave estrangeira:** nas 21 tabelas de negócio, **0 linha** fora de uma raiz
  sintética (mesmo rastreio do preflight). Operações avulsas: `E2E-S19B Avulsa 8b48`,
  `Descarga de container – HOMOLOG-SINT-AV` e `Contagem de palete - HOMOLOG-SINT-AV2`.
- **Calendário:** 10 feriados e 3 coberturas, todos fixtures (`E2E-…`, `AUTH01C2…`, `exemplo.gov.br`).
- **Municípios:** 2. `4211306` (Navegantes) com fonte oficial do IBGE: **fica**. `4208203` com nome
  `E2E-…` (sintético): sai.
- **Funções:** 4 padrão (`auxiliar_producao`, `conferente`, `operador`, `administrativo`) e `e2e_s11_fn`
  (sai).
- **Trilha de condições:** 135 linhas = 7 de `sistema` (**ficam**) + 128 sintéticas. Das 128, 87 se
  ligam a entidade existente, 40 têm motivo com marcador de teste e 1 (`municipio_catalogado`,
  06/11/2026, motivo "Homologacao S19B …") se apoia no ator: **não** é a conta administrativa real e
  já constava do inventário 045. As 18 trilhas do administrador real são de `sistema` ou ligadas às
  entidades `HOMOLOG-SINT`.

## 2. O que sai e o que fica (contagens de 10/11/2026, RLS de admin)

| Destino      | Tabelas (linhas antes → depois)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Esvaziar** | `clients` 10, `contracts` 7, `contract_terms` 9, `contract_rate_terms` 4, `contract_employee_rates` 3, `operations` 9, `operation_terms` 3, `operation_location_terms` 4, `shifts` 8, `operation_team` 14, `user_operation_access` 4, `employees` 14, `employee_cost_terms` 15, `timesheets` 42, `timesheet_entries` 56, `invoices` 7, `invoice_items` 22, `billing_additionals` 18, `container_services` 11, `container_service_participants` 14, `container_service_audit` 14, `financial_holidays` 10, `financial_calendar_coverage` 3 → **0** (301 linhas) |
| **Parcial**  | `financial_terms_audit` 135 → 7 (fica só `entity_kind = 'sistema'`); `municipality_catalog` 2 → 1; `job_functions` 5 → 4                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Intacto**  | `profiles` 15, `user_roles` (15 em 06/11/2026; a RLS do admin só mostra o próprio papel), `admin_audit_log` 9, `financial_engine_settings` 1, `pricing_settings` 1; schema `auth` inteiro; `supabase_migrations` (55)                                                                                                                                                                                                                                                                                                                                          |

Também permanecem sem mudança RLS, grants, funções, gatilhos (e seus estados), políticas, índices e
restrições. As contagens reais são revalidadas pelo próprio script (relatório `contagens_antes`) e pela
impressão digital antes da execução.

Faturas emitidas que saem (todas de clientes sintéticos): 7, entre elas `HOMOLOG-SINT-UI` R$ 965,31
(`c40428d0…`) e `HOMOLOG-SINT-AV` R$ 456,25. O `HOMOLOG-SINT-AV2` não tem fatura.

### Calendário e municípios (tratados à parte)

Mesma regra da 045: feriados e coberturas sintéticos saem e o script **recusa** a limpeza se
encontrar fonte oficial real; o município de nome sintético sai e o de fonte oficial fica. Reposição
(fora do script, depois da limpeza, por administrador no app): Itajaí pelo nome oficial e as coberturas
e feriados reais, a partir de [calendário: fontes oficiais](../financeiro/calendario-fontes-oficiais.md).

## 3. Diferenças da 045 para a 050 que o roteiro precisou tratar

| Migration | Mudança no banco                                                                                                                                                                                                                                      | Efeito no roteiro                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 046       | Fatura com lastro = apontamento **ou adicional** vinculado; guarda de `invoices` cobre também `DELETE`; `BEFORE TRUNCATE` de `timesheet_entries` e `invoice_items` recusa com adicional faturado; revoga escrita da API em `invoices`/`invoice_items` | Sem mudança de lógica: o expurgo já desliga, um a um, os gatilhos habilitados das tabelas-alvo e religa os mesmos; quem executa é o dono (`postgres`), não a API. Comentário acrescentado no passo 4.1 |
| 047       | `billing_additionals` ganha `idempotency_key` e `request_payload` (UNIQUE parcial)                                                                                                                                                                    | Nenhum (tabela esvaziada inteira); muda o hash de colunas da impressão digital em relação à 045                                                                                                        |
| 048       | `derivar_valores_por_vigencia`, `alterar_resolucao_tarifas` e `estado_motor_vigencia` substituídas                                                                                                                                                    | Nenhum; `pricing_settings` e `financial_engine_settings` seguem preservadas                                                                                                                            |
| 049       | `container_service_audit.action` aceita `corrected`; RPC `corrigir_servico_container`                                                                                                                                                                 | Nenhum (tabela esvaziada inteira; há trilha `corrected` sintética)                                                                                                                                     |
| 050       | `container_services` aceita pedido no mesmo dia da execução                                                                                                                                                                                           | Nenhum                                                                                                                                                                                                 |

Mudanças no script (todas fail-closed):

1. **Assinatura do ambiente** passa a ser a da 050 (55, `20261117120000`, `01ca9136…`). HML ainda na
   045, Production (034) ou qualquer outro banco **reprova**.
2. Prefixo `HOMOLOG-SINT` acrescentado às raízes sintéticas.
3. **Raízes presas ao inventário de 10/11/2026** (nova verificação 3.6b): os 10 clientes por ID; os
   colaboradores por contagem exata por prefixo e os 5 `HOMOLOG-SINT` por ID. Uma raiz nova ou faltante,
   **mesmo com prefixo sintético**, aborta. Nome parecido não basta.
4. **`NULL` não é `false`**: o rastreio de origem (3.6) e a trilha (3.10) usavam `x NOT IN (...)`, que
   devolve `NULL` com chave nula e deixaria a linha **fora** da contagem de "fora da origem". Passam a usar
   `(x IN (...)) IS NOT TRUE`: chave nula conta como fora e bloqueia.
5. Trilha com `entity_kind` nulo bloqueia (3.10b): o `DELETE` usa `<> 'sistema'` e não a removeria.
6. **Correção de 10/11/2026 (sessão 02): o mesmo defeito de `NULL` estava na 3.7.** Os feriados
   legados (anteriores à 044, `territory_scope = 'legado'`) têm `legal_act` nulo. A verificação
   `count(*) FILTER (WHERE NOT (legal_act LIKE 'E2E-%' OR name LIKE 'E2E-%' OR ...))` calculava, para um
   legado de nome desconhecido, `NOT (NULL OR false OR false)` = `NULL`; o `FILTER` descartava a linha,
   a contagem dava 0, a verificação aprovava e o `TRUNCATE` apagaria um feriado possivelmente real.
   Passa a ser `(...) IS NOT TRUE`: só fica dentro a linha **comprovadamente** sintética; nula ou
   desconhecida conta como fora e aborta. Revisadas todas as negações do script, com a mesma forma:
   - 3.7 coberturas (`legal_act` e `official_url` são `NOT NULL` na 044; corrigido por robustez);
   - 3.8 municípios e 3.9 funções (`name`/`code` são `NOT NULL`; `NOT LIKE`/`NOT IN` trocados);
   - 3.3 catálogo, 3.4 dono/RLS forçada e 3.5 estados de gatilho (`NOT IN`/`<>` trocados);
   - 3.11 admin real: `(email LIKE '%.invalid') IS FALSE`, e-mail nulo **não** conta como real (só
     pode reprovar);
   - impressão digital: o conjunto preservado de municípios e funções é exatamente o complemento do
     `DELETE` parcial (`(... LIKE ...) IS NOT TRUE`).

   Das negações revisadas, só a dos feriados era explorável com o esquema atual; as demais dependiam de
   colunas `NOT NULL` e passaram a não depender. Restam `entity_kind <> 'sistema'` (o nulo é
   bloqueado pela 3.10b) e `tgenabled <> 'O'` (coluna `NOT NULL` do catálogo).

## 4. Salvaguardas do script

1. **Ensaio a seco por padrão.** Sem editar a linha `bs_limpeza.executar`, nada é alterado.
2. **Assinatura do ambiente:** migrations do HML 050 e dados-assinatura sintéticos.
3. **Todas as 31 tabelas classificadas:** tabela nova ou ausente aborta.
4. **Origem sintética** em cada tabela, calendário, municípios, funções e trilha; **raízes iguais ao
   inventário**; linha fora da origem, chave nula ou registro desconhecido aborta.
5. **Trava de execução única** (advisory lock) e `LOCK TABLE` com `lock_timeout` de 5 s.
6. **Sem `CASCADE`:** referência de tabela fora da lista faz o `TRUNCATE` falhar e tudo ser desfeito.
7. **Gatilhos:** só os habilitados são desligados e exatamente os mesmos são religados; o legado
   desligado continua desligado (um `ENABLE TRIGGER USER` genérico religaria o cálculo legado).
8. **Validação integral antes do `COMMIT`:** impressão digital do que deve permanecer igual à fotografia
   inicial (Auth, perfis, papéis, motor, tarifas, migrations, catálogo, grants, RLS, gatilhos e estados),
   e contagens esperadas. Divergência lança exceção e a transação inteira é desfeita.
9. Não imprime linha de dados: o relatório só tem contagens e nomes de verificação.

## 5. Backup

O backup de 06/11/2026 é da **045** (cifrado, fora do Git, item do Chaveiro
`bs-backup-hml-2026-11-06-045`) e **não serve** para a 050: o HML recebeu 046–050 e as escritas
sintéticas de 09–10/11/2026, e o preflight 050 recusa uma cópia 045. Antes de qualquer execução é
preciso um **backup novo** do HML na 050, com o mesmo procedimento (dump de `public`, dados de `auth` e
`supabase_migrations`, papéis; cifragem AES-256-CBC/PBKDF2; hash conferido; segunda cópia em destino
independente decidido pela BS) e **restauração comprovada** numa stack local isolada. Procedimento geral:
[backup-production.md](backup-production.md). `scripts/hml-restaurar-local.sh` aceita o novo item por
`KEYCHAIN_ITEM`.

Junto com o dump, e na mesma janela sem escrita, tirar a impressão digital do HML
(`hml-impressao-digital.sql`, somente leitura) antes e depois do dump; as duas têm de ser iguais. Guardar
a saída na pasta do backup como `impressao-digital-hml.json` (aceita o JSON puro ou a saída de
`supabase db query -o json`). O ensaio **não começa** sem ela: é a referência contra a qual a cópia
restaurada é comparada.

## 6. Ensaio local da versão 050 — BLOQUEADO (10/11/2026)

**Não executado.** A máquina desta sessão (Windows) não tem Docker nem Supabase CLI (o
`scripts/testar-sql-local.sh` também os exige), não tem `python3` no `PATH`, e o backup cifrado do HML
está em outra máquina, na 045. Há um PostgreSQL 18 instalado, sem serviço ativo, mas montar nele um banco
"parecido com Supabase" seria improvisar: ele não reproduz Auth, papéis, o `postgres` não superusuário
nem os dados do HML. Nada foi declarado PASS.

Para desbloquear (sem autorização de escrita remota): uma máquina com Docker, Supabase CLI, `psql` e
`python3`; um backup **novo** do HML na 050 com a impressão digital do HML ao lado (seção 5); então
`KEYCHAIN_ITEM=<item-do-backup-050> scripts/hml-limpeza-ensaio-local.sh <pasta-do-backup> <workdir-da-stack> [porta] [impressão-do-HML]`,
exigindo **0 FAIL** em todas as seções (A–G, inclusive C1b e C1c).

**Restauração comprovada, não só concluída.** `scripts/hml-restaurar-local.sh` não para no primeiro erro
e termina com sucesso mesmo com erros; terminar não prova nada. O ensaio só aceita a cópia (seções A e G)
se:

1. o log tiver as marcas de integridade (hash dos cifrados e do texto em claro) e o resumo de **todas** as
   etapas (papéis, esquema, migrations, dados de `public`, dados de `auth`, reaplicação de privilégios);
2. cada erro listado estiver na lista aceita (hoje só `role "supabase_realtime_admin" does not exist`,
   Realtime desligado no stack local) e a soma dos listados for igual ao total da etapa (mais de 5 tipos de
   erro ou erro sem `psql:` reprova);
3. a reaplicação de privilégios tiver **0** erro (o log só traz a contagem; se houver erro, investigar à
   mão e só ampliar a lista aceita por revisão);
4. a impressão digital da cópia for **igual** à do HML (`impressao-digital-hml.json`) em todos os campos,
   exceto `catalogo.fn_privilegios_md5` e `catalogo.event_triggers_md5` (diferenças conhecidas, seção
   045 — 6). Qualquer outra diferença, inclusive de contagem, invalida a cópia.

Falha em qualquer item interrompe o ensaio (código 4) antes dos testes.

**Testes negativos com preparo comprovado.** Cada preparo (inserir, criar tabela, segurar trava, injetar a
alteração do C5) e cada limpeza é conferido pela saída exata (`returning`/contagem); um preparo não
comprovado interrompe o ensaio (código 6) e **nunca vira PASS**. Antes de inserir, confere-se que o
marcador não existe, para que um resíduo de teste anterior não faça o seguinte abortar "pelo motivo
certo" por acaso. C1b confere também que a recusa veio do inventário (3.6b), não da origem. C1c (novo):
feriado legado com `legal_act` nulo e nome desconhecido tem de abortar em
`origem sintetica: financial_holidays`; como feriado não se apaga (gatilho de imutabilidade), o dado entra
numa transação externa que o aborto desfaz, e a inserção é provada por `PREPARO_C1C=1` na saída. Depois
de C1–C4, a impressão digital tem de voltar a ser igual à linha de base.

Validação feita nesta máquina (10/11/2026, sessão 02), **sem banco**: `bash -n` dos dois scripts;
revisão do SQL contra as migrations 030, 039, 044 e 046–050; verificador estático descartável (fora do
repositório) que **reprova** o HEAD `51d18f8` (20 falhas: `NOT (...)`/`NOT LIKE`/`NOT IN`, preparo sem
conferência, sem C1c, restauração sem comparação) e **aprova** esta versão; sem `CASCADE`; modo padrão
`NAO`. O PostgreSQL 18 instalado aqui só tem as ferramentas de cliente (sem servidor), e não há
`python3`: o RED/GREEN em banco, o validador da restauração e o ensaio completo **não foram executados**.

## 7. Execução futura no HML (somente com a autorização da seção 8)

Cada passo exige o anterior concluído. Usar sempre `env -u SUPABASE_ACCESS_TOKEN`, `--project-ref
qbnfcmrxmssnwkhaitgd` explícito e confirmar o nome do projeto (`bs-logistica-homologacao`) em
`supabase projects list`.

1. **HML parado:** ninguém usando o app ligado ao HML nem testes em andamento.
2. **Linha de base, backup e ensaio:** `hml-impressao-digital.sql` no HML; backup novo (seção 5) com
   restauração local; `scripts/hml-limpeza-ensaio-local.sh` sobre esse backup com **0 FAIL**. Se o HML
   receber escrita depois do inventário de 10/11/2026, o preflight 3.6b reprova: refazer o inventário,
   revisar o script e repetir o ensaio.
3. **Ensaio a seco no HML** (script **sem editar**, modo `NAO`):
   `supabase db query --linked --project-ref qbnfcmrxmssnwkhaitgd -f docs/runbooks/limpeza-hml-sintetico.sql -o json`.
   Deve devolver `ENSAIO A SECO`, `reprovadas: 0` e contagens iguais às da seção 2.
4. **Execução:** trocar `'NAO'` por `'SIM'` na linha marcada (a única edição; aparece no diff) e rodar o
   mesmo comando. Espera-se `EXECUTADO` e `reprovadas: 0`. Falha em qualquer etapa desfaz tudo.
5. **Pós-verificação:** impressão digital igual à linha de base exceto contagens e os hashes de
   municípios e funções; head 050; motor e tarifas inalterados (`estado_motor_vigencia()` consistente,
   resolução OFF); login do admin real; listas vazias no app; operacional sem acesso a áreas
   administrativas.
6. **Reposição do calendário** (seção 2) e homologação manual do zero pelo responsável.

Critérios de interrupção: qualquer exceção, divergência de contagem, `reprovadas > 0` ou dúvida. **Não**
repetir às cegas: conferir o estado com a impressão digital antes de decidir.

Recuperação: antes do `COMMIT`, o próprio `ROLLBACK`. Depois do `COMMIT`, restaurar o backup novo (perde
apenas dados sintéticos) seguindo [backup-production.md](backup-production.md), seção 3, com autorização
própria para o destino remoto (**o script de restauração recusa destino não local**).

## 8. Autorização necessária para executar no HML

Para executar a seção 7, a pessoa responsável deve autorizar **por escrito**, citando: o projeto
`qbnfcmrxmssnwkhaitgd`; o backup novo na 050 e o destino da segunda cópia; o resultado do ensaio local
com 0 FAIL; a execução de `limpeza-hml-sintetico.sql`, primeiro a seco e depois com `'SIM'`; a janela; e
a lista da seção 2 (301 linhas de negócio e calendário, 128 trilhas sintéticas, o município de nome
sintético e a função `e2e_s11_fn`). Autorização de leitura ou de ensaio local **não** cobre isso.

## 9. Riscos e pendências

- Desabilitar gatilhos de proteção, ainda que dentro de uma transação, é o ponto sensível; mitigado pela
  guarda de origem, pelas raízes presas, pelo ensaio e pela validação antes do `COMMIT`.
- A versão 050 **não foi ensaiada**: sintaxe e comportamento do SQL só ficam comprovados no ensaio.
  Isso inclui a correção de `NULL` da sessão 02 e o validador da restauração (Python), escritos sem
  banco nem interpretador disponíveis.
- A lista de erros aceitos da restauração foi tirada do ensaio 045. Um stack local mais novo pode trazer
  erro diferente: o ensaio reprova, e ampliar a lista exige revisão, nunca ajuste para passar.
- O inventário de 10/11/2026 foi lido com a RLS do admin, sem catálogo nem Auth; o preflight cobre essas
  partes no alvo.
- Sem backup gerenciado e sem PITR no HML, a recuperação depende do backup novo e da sua segunda cópia.
- A API de gerenciamento do Supabase só é exercitada no passo 3 da seção 7.
- A conta administrativa real não tem segundo fator; a limpeza não altera isso.

## Histórico — versão 045 (06/11/2026)

Registro preservado do roteiro anterior (branch `docs/hml-limpeza-runbook`, `169f592`). Não descreve o
HML atual.

### 045 — 1. Evidência do inventário (06/11/2026, leituras em transação `READ ONLY`)

- HML: 50 migrations, head `20261112120000` (045), 31 tabelas em `public`, todas com RLS, todas
  de dono `postgres`; 16 MB; motor ativo; resolução de tarifas desligada. Sem backup gerenciado
  e sem PITR (a `supabase backups list` volta vazia).
- 413 linhas em `public`. **Origem sintética provada tabela a tabela:** nenhuma linha das 21 tabelas
  de negócio fica fora de uma raiz sintética (clientes e colaboradores com prefixo `HML-TESTE`,
  `AUTH01C2`, `E2E-S11` ou `E2E-S19B`; os filhos são rastreados por chave estrangeira). A trilha de
  condições se liga a entidade sintética, a ator de domínio `.invalid` ou a motivo de teste.
- Auth: 17 contas, das quais 16 de domínio `.invalid` e **uma conta administrativa real**, que
  precisa permanecer (o script só confere que existe admin real; não toca em `auth.*`).
- **Um gatilho já está desabilitado** (`trg_timesheet_entries_calculo_financeiro`, cálculo legado 010,
  desligado pelo motor ativo) e fica numa tabela que será esvaziada. O script restaura o estado
  **exato** de cada gatilho; um `ENABLE TRIGGER USER` genérico o religaria e reativaria o cálculo legado.
- Os 120 avisos do advisor do Supabase no HML (64 `SECURITY DEFINER` executáveis por
  `authenticated`, 50 de desempenho, 5 políticas permissivas, 1 senha vazada) não mudam com a limpeza.

### 045 — 2. O que sai e o que fica

| Destino      | Tabelas (linhas antes → depois)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Esvaziar** | `clients` 7, `contracts` 5, `contract_terms` 7, `contract_rate_terms` 4, `contract_employee_rates` 3, `operations` 6, `operation_terms` 2, `operation_location_terms` 4, `shifts` 7, `operation_team` 9, `user_operation_access` 4, `employees` 9, `employee_cost_terms` 10, `timesheets` 39, `timesheet_entries` 51, `invoices` 4, `invoice_items` 12, `billing_additionals` 15, `container_services` 9, `container_service_participants` 12, `container_service_audit` 10, `financial_holidays` 10, `financial_calendar_coverage` 3 → **0** |
| **Parcial**  | `financial_terms_audit` 123 → 7 (fica só `entity_kind = 'sistema'`: ativação do motor e das tarifas); `municipality_catalog` 2 → 1; `job_functions` 5 → 4                                                                                                                                                                                                                                                                                                                                                                                     |
| **Intacto**  | `profiles` 15, `user_roles` 15, `admin_audit_log` 9, `financial_engine_settings` 1, `pricing_settings` 1; schema `auth` inteiro (17 contas, 17 identidades, 2 fatores MFA); `supabase_migrations` (50)                                                                                                                                                                                                                                                                                                                                        |

Total: **413 → 53 linhas**. Também permanecem sem mudança RLS, grants, funções, gatilhos (e seus estados),
políticas, índices e restrições.

#### Calendário e municípios (tratados à parte)

- **Feriados (10) e coberturas (3):** todos fixtures de teste (`ATO_SINTETICO`, `exemplo.gov.br`, nomes
  `E2E-…` ou `AUTH01C2…`). São removidos. O script **recusa** a limpeza se encontrar registro com fonte oficial real.
- **Municípios (2):** `Navegantes` (4211306) tem nome real e fonte oficial do IBGE: **permanece**. O registro
  4208203 tem o nome sintético `E2E-S11 Itajaí (sintético)`; o catálogo é append-only e não aceita corrigir o
  nome, então só a remoção resolve. É removido por nome `E2E-%`.
- **Reposição (fora do script, depois da limpeza, por administrador no app):** cadastrar Itajaí pelo nome oficial
  e as coberturas e feriados reais, a partir das fontes em
  [calendário: fontes oficiais](../financeiro/calendario-fontes-oficiais.md). Nada de calendário real é carregado
  por script nem por migration.

### 045 — 5. Backup (somente leitura) e segunda cópia

Feito em 06/11/2026 sobre o HML, sem alterá-lo (a impressão digital do HML ficou idêntica antes e depois do dump),
com `supabase db dump --linked --project-ref qbnfcmrxmssnwkhaitgd` (esquema `public`, dados de `public`, dados
de `auth`, dados de `supabase_migrations`, papéis). Cifrado com AES-256-CBC/PBKDF2 (200 mil iterações); hash do
texto em claro conferido por decifragem de volta (5/5) e texto em claro apagado. Fora do repositório, em pasta `700`
na máquina de quem executou; senha no Chaveiro (item `bs-backup-hml-2026-11-06-045`). Procedimento geral:
[backup-production.md](backup-production.md).

- O backup contém dados de Auth (e-mails e hashes de senha): tratar como sensível, nunca versionar nem enviar
  junto da senha.
- **Segunda cópia:** feita em outro diretório da **mesma máquina** (hash conferido). **Isso não é cópia
  independente.** Um destino independente (disco externo cifrado ou armazenamento de outra conta) depende de
  decisão e autorização da BS; ver [backup-production.md](backup-production.md), seção 4.
- Sem backup gerenciado no plano atual, **este dump é a única recuperação**. Refazer o dump se o HML receber
  qualquer escrita antes da janela (comparar com `hml-impressao-digital.sql`).

### 045 — 6. Restauração local e ensaio (resultado de 06/11/2026)

Stack local `bs-hml-ensaio-20b` (API 58321, banco 58322; nenhuma das portas dos outros stacks), sem migrations
no diretório (o banco vem do backup). `scripts/hml-restaurar-local.sh` restaurou sem erro real; a impressão
digital da cópia coincide com a do HML em **65 de 67 campos**. As duas diferenças (`fn_privilegios_md5` e `event_triggers_md5`) são conhecidas e aceitas:

- privilégios de função (6 funções): 5 RPCs operacionais ganham `EXECUTE` para `postgres` e `proteger_ultimo_admin`
  ganha `EXECUTE` de `PUBLIC` — efeito da reconciliação, já registrado em [backup-production.md](backup-production.md);
- event trigger `ensure_rls`: o `pg_dump` não o traz e, localmente, exige dono superusuário; só dispara em
  `CREATE TABLE`, que o expurgo não usa;
- além disso, o papel `supabase_realtime_admin` não existe no stack local (Realtime desligado): é a única mensagem de erro da restauração e não afeta o ensaio.

`scripts/hml-limpeza-ensaio-local.sh`: **35 PASS, 0 FAIL**.

| Seção | O que prova                                                                                                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Cópia isolada (porta e `project_id` próprios); 31 tabelas, 17 contas, migrations 50/045; gatilho legado desabilitado                                                                                                                               |
| B     | Ensaio a seco conclui e deixa a impressão digital (inclusive todas as contagens) idêntica                                                                                                                                                          |
| C     | Aborta sem alterar nada: dado fora dos prefixos sintéticos, migrations diferentes, tabela nova, tabela em uso, falha na validação final (com rollback total e gatilhos no estado original)                                                         |
| D     | Execução real: 23 tabelas com 0 linhas; trilha 7; municípios 1; funções 4; preservadas iguais; Auth, perfis, papéis, migrations, RLS, grants, funções, gatilhos, políticas, índices e restrições idênticos; só o gatilho legado segue desabilitado |
| E     | Depois do expurgo, as proteções voltaram a valer nas tabelas esvaziadas (`TRUNCATE`/`DELETE` recusados)                                                                                                                                            |
| F     | Reexecução em alvo já limpo aborta no preflight                                                                                                                                                                                                    |
| G     | O mesmo script enviado como **uma única consulta** (semântica da API de gerenciamento) dá o mesmo resultado                                                                                                                                        |

Limites do ensaio: Postgres local é superusuário no ensaio de restauração (o expurgo roda como `postgres`, não
superusuário); a API de gerenciamento do Supabase **não** foi exercitada (seria execução remota). O primeiro contato
com ela é o passo 3 da seção 7.
