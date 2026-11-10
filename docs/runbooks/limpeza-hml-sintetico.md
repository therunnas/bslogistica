# Limpeza dos dados sintéticos do HML — runbook e ensaio

SDLC: Manutenção / Preparação de homologação. **Este documento é um plano com ensaio local.
Nada foi executado no HML.** A execução exige autorização específica (seção 8). Estado
factual: [HANDOFF](../HANDOFF.md). Condições comuns de runbooks: [índice](README.md).

Objetivo: deixar o HML (`qbnfcmrxmssnwkhaitgd`) sem dados de negócio sintéticos para uma
homologação funcional do zero, **preservando** esquema, RLS, grants, funções, gatilhos,
Auth, perfis, papéis, histórico de migrations e configurações financeiras. Não cria
projeto Supabase nem altera Production.

Artefatos:

| Arquivo                                                                                | Função                                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [limpeza-hml-sintetico.sql](limpeza-hml-sintetico.sql)                                 | Expurgo em uma transação, fail-closed. **Modo padrão `NAO`: ensaio a seco que não altera dado.**              |
| [hml-impressao-digital.sql](hml-impressao-digital.sql)                                 | Só leitura. JSON com migrations, contagens, Auth e hashes do catálogo, para comparar estados.                 |
| [../../scripts/hml-restaurar-local.sh](../../scripts/hml-restaurar-local.sh)           | Restaura o backup cifrado num Supabase **local** isolado. Recusa destino que não esteja vazio.                |
| [../../scripts/hml-limpeza-ensaio-local.sh](../../scripts/hml-limpeza-ensaio-local.sh) | Ensaio completo na cópia local: restauração limpa, a seco, cinco testes negativos, execução real, reexecução. |

## 1. Evidência do inventário (06/11/2026, leituras em transação `READ ONLY`)

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

## 2. O que sai e o que fica

| Destino      | Tabelas (linhas antes → depois)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Esvaziar** | `clients` 7, `contracts` 5, `contract_terms` 7, `contract_rate_terms` 4, `contract_employee_rates` 3, `operations` 6, `operation_terms` 2, `operation_location_terms` 4, `shifts` 7, `operation_team` 9, `user_operation_access` 4, `employees` 9, `employee_cost_terms` 10, `timesheets` 39, `timesheet_entries` 51, `invoices` 4, `invoice_items` 12, `billing_additionals` 15, `container_services` 9, `container_service_participants` 12, `container_service_audit` 10, `financial_holidays` 10, `financial_calendar_coverage` 3 → **0** |
| **Parcial**  | `financial_terms_audit` 123 → 7 (fica só `entity_kind = 'sistema'`: ativação do motor e das tarifas); `municipality_catalog` 2 → 1; `job_functions` 5 → 4                                                                                                                                                                                                                                                                                                                                                                                     |
| **Intacto**  | `profiles` 15, `user_roles` 15, `admin_audit_log` 9, `financial_engine_settings` 1, `pricing_settings` 1; schema `auth` inteiro (17 contas, 17 identidades, 2 fatores MFA); `supabase_migrations` (50)                                                                                                                                                                                                                                                                                                                                        |

Total: **413 → 53 linhas**. Também permanecem sem mudança RLS, grants, funções, gatilhos (e seus estados),
políticas, índices e restrições.

### Calendário e municípios (tratados à parte)

- **Feriados (10) e coberturas (3):** todos fixtures de teste (`ATO_SINTETICO`, `exemplo.gov.br`, nomes
  `E2E-…` ou `AUTH01C2…`). São removidos. O script **recusa** a limpeza se encontrar registro com fonte oficial real.
- **Municípios (2):** `Navegantes` (4211306) tem nome real e fonte oficial do IBGE: **permanece**. O registro
  4208203 tem o nome sintético `E2E-S11 Itajaí (sintético)`; o catálogo é append-only e não aceita corrigir o
  nome, então só a remoção resolve. É removido por nome `E2E-%`.
- **Reposição (fora do script, depois da limpeza, por administrador no app):** cadastrar Itajaí pelo nome oficial
  e as coberturas e feriados reais, a partir das fontes em
  [calendário: fontes oficiais](../financeiro/calendario-fontes-oficiais.md). Nada de calendário real é carregado
  por script nem por migration.

## 3. Por que não é um `DELETE`

O HML tem cerca de 40 gatilhos de imutabilidade que recusam `DELETE` e `TRUNCATE` por desenho (faturas,
Containers, adicionais, tarifas, diárias individuais, calendário, catálogo de municípios, funções, trilha de
condições). Há FKs com `CASCADE` (`clients` → contratos, faturas, operações) e `RESTRICT`. O papel `postgres`
hospedado não é superusuário (`session_replication_role` indisponível), mas é **dono** das tabelas e pode usar
`ALTER TABLE … DISABLE TRIGGER`, que é transacional.

Decisão: **expurgo transacional controlado** — desabilitar, um a um, só os gatilhos que estavam habilitados;
`TRUNCATE` de lista explícita **sem `CASCADE`**; religar exatamente os mesmos; validar tudo; só então `COMMIT`.
Alternativas descartadas: `supabase db reset --linked` (recria schemas, risco sobre Auth e grants; proibido) e
manter os dados com outro prefixo (faturas fechadas e calendário sintético continuariam poluindo Dashboard,
Fechamento e Relatórios).

## 4. Salvaguardas do script (todas exercitadas no ensaio)

1. **Ensaio a seco por padrão.** Sem editar a linha `bs_limpeza.executar`, nada é alterado.
2. **Assinatura do ambiente:** conjunto de migrations igual ao do HML 045 (50, head `20261112120000`, hash do
   conjunto) e dados-assinatura sintéticos. Production (034) ou outro banco **reprova**.
3. **Todas as 31 tabelas classificadas:** tabela nova ou ausente aborta.
4. **Origem sintética em cada tabela**, calendário, municípios, funções e trilha; linha fora da origem aborta.
5. **Trava de execução única** (advisory lock) e `LOCK TABLE` com `lock_timeout` de 5 s; tabela em uso aborta.
6. **Sem `CASCADE`:** referência de tabela fora da lista faz o `TRUNCATE` falhar e tudo ser desfeito.
7. **Validação integral antes do `COMMIT`:** impressão digital do que deve permanecer igual à fotografia inicial,
   estado individual de cada gatilho igual ao original e contagens esperadas. Qualquer divergência lança exceção
   e a transação inteira é desfeita.
8. Não imprime linha de dados: o relatório só tem contagens e nomes de verificação.

## 5. Backup (somente leitura) e segunda cópia

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

## 6. Restauração local e ensaio (resultado de 06/11/2026)

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

## 7. Execução futura no HML (somente com a autorização da seção 8)

Cada passo exige o anterior concluído. Usar sempre `env -u SUPABASE_ACCESS_TOKEN`, `--project-ref qbnfcmrxmssnwkhaitgd`
explícito e confirmar o nome do projeto (`bs-logistica-homologacao`) em `supabase projects list`.

1. **HML parado:** ninguém usando o Preview vinculado nem testes em andamento.
2. **Linha de base e backup novos:** `hml-impressao-digital.sql` (comparar com o desta sessão: se diferir, o HML
   recebeu escrita; refazer dump e ensaio); novo dump cifrado conforme a seção 5; repetir
   `scripts/hml-limpeza-ensaio-local.sh` com o dump novo (exige 0 FAIL).
3. **Ensaio a seco no HML** (script **sem editar**, modo `NAO`):
   `supabase db query --linked --project-ref qbnfcmrxmssnwkhaitgd -f docs/runbooks/limpeza-hml-sintetico.sql -o json`.
   Deve devolver `ENSAIO A SECO`, `reprovadas: 0` e contagens iguais às da seção 2. Só toma travas por instantes.
4. **Execução:** trocar `'NAO'` por `'SIM'` na linha marcada (a única edição; aparece no diff) e rodar o mesmo comando.
   Espera-se `EXECUTADO` e `reprovadas: 0`. Falha em qualquer etapa desfaz tudo.
5. **Pós-verificação:** `hml-impressao-digital.sql` deve diferir da linha de base **apenas** nas contagens e nos hashes
   de municípios e funções; head 045; motor e tarifas inalterados; login do admin real; listas vazias no app;
   operacional sem acesso a áreas administrativas.
6. **Reposição do calendário** (seção 2) e início da homologação do zero.

Critérios de interrupção: qualquer exceção, divergência de contagem, `reprovadas > 0` ou dúvida. **Não** repetir às
cegas: conferir o estado com a impressão digital antes de decidir.

Recuperação: antes do `COMMIT`, o próprio `ROLLBACK`. Depois do `COMMIT`, restaurar o dump (perde apenas dados
sintéticos) seguindo [backup-production.md](backup-production.md), seção 3, com os ajustes registrados em
`scripts/hml-restaurar-local.sh` (adaptar o destino com autorização própria; **o script recusa destino não local**).

## 8. Autorização necessária para executar no HML

Para executar a seção 7, a pessoa responsável deve autorizar **por escrito**, citando: o projeto
`qbnfcmrxmssnwkhaitgd`; a execução de `limpeza-hml-sintetico.sql`, primeiro a seco e depois com `'SIM'`; a janela;
a decisão sobre o destino da segunda cópia do backup; e a lista da seção 2 (inclusive a remoção do município de nome
sintético e dos 116 registros de trilha sintética). Autorização de leitura ou de ensaio local **não** cobre isso.

## 9. Riscos e pendências

- Desabilitar gatilhos de proteção, ainda que dentro de uma transação, é o ponto sensível; mitigado pela guarda de
  origem sintética, pelo ensaio e pela validação antes do `COMMIT`.
- Sem backup gerenciado e com a segunda cópia ainda na mesma máquina, a recuperação depende de um único notebook.
- O script fixa a assinatura do HML 045 (hash do conjunto de migrations). Uma migration futura no HML exige
  reavaliar e atualizar o script antes de usá-lo.
- A API de gerenciamento só foi exercitada em leitura; o passo 3 da seção 7 é a prova no alvo.
- A conta administrativa real não tem segundo fator; a limpeza não altera isso.
