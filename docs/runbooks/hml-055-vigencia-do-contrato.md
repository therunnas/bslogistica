# Roteiro — aplicar a migration 055 (vigência do contrato) no HML

**Somente preparação.** Nada deste roteiro foi executado. Cada etapa remota exige autorização
nominal própria para o HML (`bs-logistica-homologacao`, ref `qbnfcmrxmssnwkhaitgd`); Production não
faz parte dele. Contexto da regra e dos testes: [GATE-C-D1](../qa/GATE-C-D1-vigencia-do-contrato.md).

## 0. Pré-requisitos (antes de pedir a autorização)

- PR do D1 com CI `validar`, `sql-local` e `e2e-local` SUCCESS no SHA que contém a 055, sem merge.
- Arquivo `supabase/migrations/20261122120000_055_vigencia_do_contrato.sql` idêntico ao do PR
  (registrar o SHA-256 do arquivo e o SHA do commit).
- Decisão registrada sobre o contrato TESTE-MANUAL (fim 01/01/0001, DEC-CP02-03) e sobre os 2
  lançamentos fora da vigência dele — a 055 **não** depende dela (CHECK NOT VALID), mas a decisão
  define o que fazer depois. Nenhuma correção de dado faz parte deste roteiro.
- Transporte de leitura: endpoint `/database/query/read-only` da Management API (papel
  `supabase_read_only_user`), uma instrução por chamada. Aplicação: **somente**
  `docs/runbooks/aplicar-migration-api.py`.

## 1. Confirmação do projeto e saúde (só leitura)

1. `GET /v1/projects/qbnfcmrxmssnwkhaitgd`: nome `bs-logistica-homologacao`, região `sa-east-1`,
   status `ACTIVE_HEALTHY`; ref diferente de `ehkduqokntemtmqzdrbd` (Production).
2. Health de `db`, `auth` e `rest`: `ACTIVE_HEALTHY`.
3. Primeira consulta: `select current_database(), version(), current_setting('transaction_read_only')`
   → `postgres`, PostgreSQL 17.x, `on`.
4. Migrations: head `20261121120000` (054), **59** versões distintas, md5 das versões
   `6474986cf48d19713e018c332a761807`; nenhuma 055 registrada.

## 2. Backup e recuperação

- Backup lógico **novo** pelo endpoint somente leitura (mesmo método da sessão 27: JSON de `public`,
  `supabase_migrations.schema_migrations`, `auth.users`, `auth.identities`, `auth.mfa_factors`, com
  contagem e md5 por tabela calculados no HML e fotografia do catálogo), cifrado (AES-256-CBC, PBKDF2),
  arquivo e senha entregues separados ao responsável, fora do Git.
- Restauração comprovada num Supabase **local** descartável (contagem e md5 por tabela iguais; FKs
  sem órfãs) antes de aplicar.
- Alternativa aceitável: se a fotografia do HML ainda for idêntica ao backup da sessão 27 (35 checksums
  e catálogo iguais), esse backup continua vigente — registrar a comparação.
- Cobertura parcial declarada: sem tokens/sessões do Auth, configuração de Auth, chaves, `vault`,
  Storage e Vercel.

## 3. Verificação dos dados existentes (só leitura)

Rodar `supabase/preflight/055_vigencia_do_contrato_preflight.sql` pelo transporte de leitura (é um
único SELECT dentro de `begin transaction read only … rollback`; pelo endpoint, enviar só o SELECT).
Esperado hoje (pelo backup da sessão 27, conferido localmente):

| Item | Esperado |
| --- | --- |
| `migration_055_aplicada` | `false` |
| contratos / sem fim | 2 / 1 |
| `fim_antes_do_inicio`, `ano_fora_de_1900_2100`, `que_a_055_recusaria_numa_edicao` | 1 (TESTE-MANUAL) |
| apontamentos / em operação sem contrato | 5 / 0 |
| `servico_fora_da_vigencia` (faturado / não faturado) | 2 (0 / 2) |
| `ausencia_fora_da_vigencia` | 0 |
| adicionais e serviços de contêiner fora da vigência | 0 / 0 |

Também: contagem e md5 por tabela de `public` (fotografia "antes"), RLS em todas, flags financeiras.

## 4. Aplicação (escrita autorizada)

1. Conferência sem escrita:
   `python3 -I docs/runbooks/aplicar-migration-api.py qbnfcmrxmssnwkhaitgd supabase/migrations/20261122120000_055_vigencia_do_contrato.sql 20261121120000`
   → `CONFERÊNCIA OK`.
2. Aplicação, uma única vez:
   `BS_CONFIRMO_PROJETO=qbnfcmrxmssnwkhaitgd python3 -I docs/runbooks/aplicar-migration-api.py qbnfcmrxmssnwkhaitgd supabase/migrations/20261122120000_055_vigencia_do_contrato.sql 20261121120000 --executar`
   → `RESULTADO: PASS` (versão nova = 055, 60 migrations, nenhuma tabela com menos linhas, RLS em
   todas, motor e tarifas iguais). A autoverificação da própria 055 aborta a transação inteira se o
   catálogo não ficar como esperado.

## 5. Pós-verificação (só leitura)

- Head `20261122120000`, **60** versões distintas, registro único da 055.
- Catálogo: gatilho `trg_timesheet_entries_bloqueia_fora_da_vigencia` (BEFORE INSERT OR UPDATE, ROW,
  habilitado); função `recusar_execucao_fora_da_vigencia()` SECURITY DEFINER da `postgres`,
  `search_path` fixo, sem EXECUTE para `anon`, `authenticated`, `service_role`,
  `bslog_rpc_operacional` e PUBLIC; CHECK `contracts_vigencia_valida` presente e **não validado**;
  `trg_timesheet_entries_zz_versao` continua o último BEFORE; nenhuma outra função, policy, grant ou
  RLS alterada (diff do catálogo contra a fotografia "antes": só esses três objetos).
- Dados: md5 de todas as tabelas de `public` **idêntico** ao "antes"; preflight com as mesmas
  contagens e `migration_055_aplicada = true`; financeiro igual (R$ 1.250,00 cobrados, R$ 770,00 de
  custo, 1 fatura).

## 6. Testes de vigência no HML

Só com autorização de escrita que inclua dados sintéticos de teste, **dentro de transação desfeita**
(nada gravado), como nas sessões de 046–051:

- execução no primeiro e no último dia aceita; antes do início e depois do fim recusada (23514,
  detalhe `vigencia_do_contrato`); contrato sem fim aceito; operação sem contrato aceita; ausência
  fora da vigência aceita;
- contrato novo com fim antes do início ou ano 0001 recusado (API e `criar_contrato_com_vigencia`);
- registro antigo: novo lançamento na operação do TESTE-MANUAL recusado; editar o contrato sem
  corrigir as datas recusado; editar a observação de um lançamento antigo aceito.

Depois, no Preview (Claude in Chrome): a tela do admin mostra a mensagem do banco ao salvar um dia
fora da vigência; a do operador mostra o texto fixo da vigência. Sem gravar dado real.

## 7. Reversão

`docs/runbooks/rollback-vigencia-do-contrato.sql` (remove gatilho, função e CHECK; não toca dados nem
`schema_migrations`), pelo mesmo executor ou pelo SQL Editor, **só com autorização específica**. O
registro da 055 em `schema_migrations` é preservado e a reversão fica registrada como operação
distinta. Se a aplicação falhar, a transação inteira é desfeita (envelope `begin`/`commit` + registro
na mesma transação): não há reversão a fazer, só análise.

## 8. Critérios objetivos de NO-GO (parar antes de escrever)

- Projeto, nome ou região diferentes; ref de Production em qualquer lugar; saúde diferente de
  `ACTIVE_HEALTHY`; falha de autenticação SQL.
- Head diferente de 054, número de versões diferente de 59, md5 das versões diferente, ou 055 já
  registrada.
- Backup novo não restaurado localmente com sucesso (ou fotografia diferente do backup vigente).
- Preflight com números diferentes dos esperados sem explicação (ex.: lançamento fora da vigência
  **faturado**, novos contratos inválidos) — reavaliar antes de aplicar.
- Arquivo da 055 diferente do validado na CI.
- Conferência do executor diferente de `CONFERÊNCIA OK`.
- Depois da aplicação: executor diferente de PASS, md5 de dados diferente, objeto inesperado no
  catálogo → parar, não reaplicar, analisar com o backup.
