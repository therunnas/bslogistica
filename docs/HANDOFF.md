# Handoff ativo

<!-- workflow-handoff:v1 -->

Checkpoint curto para retomar o trabalho sem depender de conversa anterior. O
estado factual detalhado permanece em
[ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md), e a fila em
[PROGRESS.md](../PROGRESS.md). Como gravar e reconciliar este checkpoint entre
Codex CLI e Claude Code: [Transferência entre agentes](WORKFLOW.md#transferência-entre-agentes).

## Identificação

| Campo                     | Valor                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Etapa                     | FIN-PR-11 — preparação de HML e homologação de Containers                              |
| Gate atual                | Gate 4 — backup de HML restaurado e dry-run feito; aguarda autorização para aplicar    |
| Último gate concluído     | `CHECK-UP-REC-01` para HML — backup cifrado restaurado e conferido em instância local  |
| Worktree                  | `/private/tmp/bs-workflow-01`                                                          |
| Branch                    | `docs/fin-pr-11-preparacao-hml`                                                        |
| Base                      | `314c08cb20e9a32dd10b4a0665e1be7dad108264` (`origin/main`)                             |
| HEAD validado             | `2cf0b1f34b5d59b2084caa35574c40fd8c18cead`; local = remoto; CI run 42027079244 verde   |
| Alterações não commitadas | Nenhuma; este checkpoint vai no commit seguinte ao validado                            |
| PR                        | [#98 — Draft](https://github.com/therunnas/bslogistica/pull/98), só documentação       |
| Ambiente-alvo             | HML `qbnfcmrxmssnwkhaitgd`; nenhuma escrita remota executada                           |
| Última ação comprovada    | Backup HML cifrado e restaurado; dry-run 035–045 no HML; ensaio 035–045 na cópia local |
| Próxima ação exata        | Pedir autorização para aplicar 035–045 em HML; depois, homologar Containers no Preview |

## Evidências

- PR #97 mergeado em `314c08c`; CI de `main` verde; Production publicada antes da
  CI terminar (`dpl_ALDY5SPhRiWMiHW3qr6xDS3s74hk`). PR #98 aberto em Draft em
  `2cf0b1f`, CI verde.
- API da Vercel: Preview (todas as branches e `staging`) → HML; Production →
  Production. Preview genérico sem `service_role`; Containers não dependem dele.

### Backup de HML (05/11/2026, 12:26:50 UTC)

- Origem confirmada: `qbnfcmrxmssnwkhaitgd` = `bs-logistica-homologacao`, head 034.
- Conteúdo: papéis do cluster, esquema (`public` e demais schemas do projeto),
  dados de `public`, `auth` e `storage`, e o histórico `supabase_migrations`.
- Pacote cifrado com `age` (chave X25519 gerada para este backup):
  `hml-qbnfcmrxmssnwkhaitgd-034-20261105T122650Z.tar.age`, SHA-256
  `03eccd7042c88e1977246458079b0429af9053b8b547e0d07f637f3009b8ceac`; tar interno
  SHA-256 `33068983313cb1bcc9285b13d61174364a39a9e799fefd19980f7b370e00291a`.
- Arquivo e chave ficam fora do repositório, sob guarda do usuário; caminhos e
  chave não se registram aqui. Cópias em claro foram apagadas após o teste.

### Restauração (instância Supabase local descartável, Postgres 17)

Restaurado **a partir do arquivo cifrado**, com hash conferido, e comparado com o
HML ao vivo por consultas somente leitura:

- iguais: 21 tabelas, 21 com RLS, 70 policies, 120 funções, 65 triggers, 6
  extensões, 39 migrations (última 034), 3 usuários e 3 identidades de Auth,
  contagem exata de linhas das 24 tabelas conferidas (97 linhas);
- ACL idênticas por impressão digital: tabelas, colunas, `default privileges` e
  schema `public`. Em funções, só `proteger_ultimo_admin()` difere no texto
  (`NULL` no HML, forma explícita do mesmo padrão na cópia; efeito idêntico);
- papel `bslog_rpc_operacional`: dono de 5 funções, 55 grants por coluna,
  nenhum por tabela, sem `CREATE` em `public`;
- RLS funcional: `authenticated` sem papel lê 0 linhas; `anon` negado por grant;
  o papel da RPC não lê `billed_amount`; `TRUNCATE` igual ao HML.

Ajustes que o procedimento de restauração exige (o dump sozinho não basta):

1. `roles.sql` como `supabase_admin` (grant de plataforma ao Realtime);
2. membership `bslog_rpc_operacional` → `postgres` (não vem no dump de papéis) e
   `CREATE` em `public` ao papel só durante a carga, revogado em seguida;
3. dados com `session_replication_role = replica` (FKs circulares em
   `contract_terms`, `employee_cost_terms`, `operation_terms`);
4. omitir blocos `COPY` vazios de tabelas de Auth que a imagem local não tem
   (31 blocos, todos com zero linhas no HML);
5. revogar os `default privileges` implícitos de `anon`/`authenticated`/
   `service_role` e reaplicar os `GRANT`/`REVOKE` do dump;
6. recriar o event trigger `ensure_rls` (como `postgres`, funcionou na cópia).

Não coberto pelo backup: configuração de Auth (provedores, SMTP, URLs), segredos
e chaves do projeto, `vault` (0 segredos no HML), objetos do Storage (0 no HML),
os outros 6 event triggers de plataforma e a configuração da Vercel. A cópia
local usou imagens do CLI v2.117, com Auth mais antigo que o do HML.

## Migrations por ambiente

- Local/CI: 001–045 versionadas e testadas em instâncias descartáveis.
- HML `qbnfcmrxmssnwkhaitgd`: 034 (`20261101120000`), reconfirmado antes e
  depois do dry-run.
- Production `ehkduqokntemtmqzdrbd`: 034 (`20261101120000`).

### Dry-run e ensaio

- `db push --dry-run` no HML listou exatamente as 11 migrations, de
  `20261102120000_035` a `20261112120000_045`, nesta ordem; sem seeds nem roles.
- Ensaio na cópia restaurada do HML, executor `postgres` não-superusuário: as 11
  aplicaram sem erro; histórico chegou a 50 (045). Valores de
  `timesheet_entries` e `billing_additionals` idênticos ao HML (hash); 3 tabelas
  `container_*` com RLS; RPCs da 045 `SECURITY DEFINER`; grants do papel da RPC
  inalterados; nenhuma tabela de `public` sem RLS.

### Plano para HML (aplicação ainda não autorizada)

1. Autorização nominal: HML, ref `qbnfcmrxmssnwkhaitgd`, migrations 035–045.
2. Reconfirmar head 034 e repetir o `--dry-run` com a mesma lista de 11.
3. `db push --linked --project-ref qbnfcmrxmssnwkhaitgd`, sem `--include-all`,
   com `env -u SUPABASE_ACCESS_TOKEN` e sem `SUPABASE_PROJECT_ID` no ambiente.
4. Falha interrompe; não repetir sem diagnóstico. Recuperação pelo backup acima
   ou pelos runbooks de [runbooks/README.md](runbooks/README.md), com autorização.
5. Repetir as verificações do ensaio contra o HML e registrar o novo head aqui e
   em [AMBIENTES.md](AMBIENTES.md).

Riscos: a 036 muda HE e sábado para lançamentos novos ou editados (decisão do
proprietário de 30/10/2026); a 041 e a 042 nascem desligadas; nunca aplicar a
045 isolada. Production é gate separado, depois da homologação.

### Roteiro de homologação de Containers (navegador, Preview → HML)

Pré-requisitos: schema 045 em HML; Preview do HEAD candidato confirmado em HML;
conta `admin` de teste e, para o item 1, conta `operacional` de teste aprovadas.
O HML tem 3 contas de Auth, 1 papel atribuído e nenhum fator MFA.

1. Acesso: `admin` vê Containers; `operacional` não abre `/containers`.
2. Registro pelo menu: cliente, operação opcional, data, descrição, quantidade,
   valor total e participantes com valor por pessoa; lista e detalhe conferem.
3. Rateio explícito de um total entre participantes; nunca divisão automática.
4. Atalho no cartão de Operações: cliente e operação preenchidos; URL com
   operação inválida, repetida ou de outro cliente é bloqueada.
5. Idempotência: duplo clique gera um registro; recarregar recupera a intenção.
6. Recusas: quantidade zero, centavos inválidos, soma de participantes divergente.
7. Cancelamento com motivo cancela a receita junto; adicional vinculado não se
   cancela isoladamente; serviço faturado não se cancela.
8. Fatura com diárias e container na mesma operação: adicional uma única vez;
   fatura só com container válida; competência diferente da execução.
9. Custo devido só em visões internas; receita não duplicada; auditoria registra
   registro e cancelamento.

Testes automatizados e o ensaio local não substituem nenhum item acima.

## Autorizações

- vigentes na sessão 03: publicar a branch e o PR #98 em Draft; backup cifrado
  só de HML; restauração local descartável; dry-run de 035–045.

## Proibições

- sem aplicar migration em HML ou Production;
- sem alteração de Production ou de configuração remota;
- sem merge;
- sem publicar dados do HML, chaves ou caminhos do backup;
- sem regra financeira, Auth, RLS, RPC ou faturamento;
- sem iniciar FIN-PR-12 ou FIN-PR-13.

## Bloqueios e riscos

- backup e chave estão em armazenamento temporário local: mover para guarda
  durável e separada antes da aplicação em HML;
- natureza dos dados de HML (sintéticos ou não) e contas de teste ainda não
  aprovadas para homologação;
- merge em `main` publica Production antes da CI; contenção administrativa
  pendente na Vercel/GitHub;
- Production roda a interface de Containers sem o schema 045; o recurso fica
  indisponível por desenho, sem homologação.

## Retomada

Sequência preservada: **migrations 035–045 em HML → homologação de Containers
(FIN-PR-11) → FIN-PR-12 → FIN-PR-13**.

1. Reconciliar Git e GitHub conforme
   [Transferência entre agentes](WORKFLOW.md#reconciliação-na-retomada).
2. Confirmar com o usuário que backup e chave estão em guarda durável.
3. Com autorização, executar o plano de HML acima.
4. Homologar Containers pelo roteiro; registrar executor, data, HEAD, deployment
   e migration head.
5. Se houver divergência, atualizar diagnóstico e este checkpoint antes de agir.
