# Handoff ativo

<!-- workflow-handoff:v1 -->

Checkpoint curto para retomar o trabalho sem depender de conversa anterior. O
estado factual detalhado permanece em
[ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md), e a fila em
[PROGRESS.md](../PROGRESS.md). Como gravar e reconciliar este checkpoint entre
Codex CLI e Claude Code: [Transferência entre agentes](WORKFLOW.md#transferência-entre-agentes).

## Identificação

| Campo                     | Valor                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Etapa                     | FIN-PR-11 — homologação de Containers                                                                        |
| Gate atual                | Gate 5 — homologação real no navegador (Preview → HML); aguarda execução pelo usuário                        |
| Último gate concluído     | Gate 4 — migrations 035–045 aplicadas e verificadas em HML (sessão 05)                                       |
| Worktree                  | `/private/tmp/bs-workflow-01`                                                                                |
| Branch                    | `docs/fin-pr-11-preparacao-hml`                                                                              |
| Base                      | `314c08cb20e9a32dd10b4a0665e1be7dad108264` (`origin/main`)                                                   |
| HEAD validado             | `d6f41860f56b4796b9ef9f3fc38d2dd190654442`; local = remoto; CI run 42029869726 verde                         |
| Alterações não commitadas | Nenhuma; este checkpoint vai no commit seguinte ao validado                                                  |
| PR                        | [#98 — Draft](https://github.com/therunnas/bslogistica/pull/98), só documentação                             |
| Ambiente-alvo             | HML `qbnfcmrxmssnwkhaitgd` (alterado: 034 → 045); Production intocado                                        |
| Última ação comprovada    | `db push` 035–045 em HML às 13:03:22–13:03:36 UTC, sem erro, verificações pós-migration OK                   |
| Próxima ação exata        | Usuário executa o roteiro de 9 fluxos no Preview `dpl_7qDuM37uyJBSCgHvH9E7mjVH4yZU` com conta admin de teste |

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
- Cópias em claro foram apagadas após o teste de restauração.

### Guarda do backup (sessão 04, 05/11/2026)

- Arquivo cifrado e `.sha256` na pasta local persistente de backups do projeto,
  já usada para backups anteriores; chave `age` na pasta local de chaves do
  projeto, separada da do arquivo. Ambas no home do usuário, com acesso só do
  dono (0700/0600), fora de pastas temporárias, do repositório e da sincronização
  com iCloud, em disco com FileVault ligado. Caminhos não se registram aqui.
- SHA-256 do arquivo no destino igual ao registrado; chave idêntica byte a byte
  à original.
- Recuperação: o arquivo do destino, decifrado em fluxo com a chave do destino
  (sem gravar em claro), reproduz o SHA-256 do tar interno; o pacote tem os 7
  arquivos esperados e o histórico termina em `20261101120000`. É o mesmo pacote
  restaurado e conferido na sessão 03.
- A cópia de origem em armazenamento temporário não foi apagada.
- Limite: arquivo e chave estão no mesmo computador. Perda ou roubo da máquina
  leva os dois; cópia fora da máquina depende de decisão do usuário.

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
- HML `qbnfcmrxmssnwkhaitgd`: **045** (`20261112120000`) desde 05/11/2026 13:03
  UTC; antes, 034 (`20261101120000`). 50 migrations, nenhuma só remota.
- Production `ehkduqokntemtmqzdrbd`: 034 (`20261101120000`), não tocado.

### Aplicação em HML (sessão 05, 05/11/2026)

Preflight, todos aprovados antes de qualquer escrita:

- HML e Production distintos e `ACTIVE_HEALTHY`; link local apontando ao HML;
  HML exatamente na 034, sem migration desconhecida; nenhum processo de
  migration local, nenhuma sessão ativa nem advisory lock no banco;
- backup da guarda local íntegro (SHA-256 igual ao registrado), chave
  disponível e decifragem do tar interno conferida; HML idêntico ao estado do
  backup (linhas, catálogo e ACL);
- `scripts/testar-compatibilidade-deploy.sh` em cópia isolada do código
  (instância local própria, portas exclusivas): **10 cenários, 034 → 045, 665
  asserções PASS, 0 falhas**, com build, páginas de Containers e ausência segura
  da capacidade antes da 045;
- `db push --dry-run`: exatamente 035, 036, 037, 038, 039, 040, 041, 042, 043,
  044, 045; sem seeds nem roles;
- escritas de nível superior nas 035–045: só DDL, catálogo inicial de funções
  (039) e registro único de preços desligado (041); nada recalcula lançamentos,
  adicionais ou faturas existentes.

Aplicação: `db push --linked --project-ref qbnfcmrxmssnwkhaitgd --yes`, sem
`--include-all`, head reconfirmado imediatamente antes. As 11 aplicaram em
ordem, sem erro.

Verificação pós-migration (somente leitura):

- histórico: 50 migrations, última `20261112120000`, nenhuma pendente;
- integridade: linhas das 24 tabelas anteriores iguais; hash de
  `timesheet_entries` (valores, status, horários, `invoice_id`) e de
  `billing_additionals` iguais à linha de base; 4 lançamentos com R$ 328,13
  cobrados e R$ 235,00 de custo; 0 duplicidades; 0 faturas;
- tabelas novas só com os registros previstos: 4 funções no catálogo e 1
  configuração de preços (`tarifas_por_funcao = false`);
- segurança: 31 tabelas em `public`, todas com RLS; 87 policies (43
  restritivas); `anon` sem DML; `TRUNCATE` inalterado; `ensure_rls` ativo;
- papel `bslog_rpc_operacional`: mesmas 5 funções, 55 grants por coluna, nenhum
  por tabela, nenhuma coluna financeira nem de containers, sem `CREATE`;
- paridade com o banco montado só pelas migrations: definições de funções,
  policies, triggers, constraints, colunas e ACL de colunas idênticas; nas ACL
  de tabelas e funções o HML é igual ou **mais restrito** (27 diferenças, todas
  restrições preexistentes), nunca mais amplo;
- Containers: `container_services` (14 constraints, 4 índices),
  `container_service_participants` (4, 2) e `container_service_audit` (3, 2),
  RLS e 2 policies cada, `authenticated` só `SELECT`; RPCs
  `registrar_servico_container(jsonb,uuid,text)` e
  `cancelar_servico_container(uuid,text)` `SECURITY DEFINER`, `search_path`
  fixo, sem `EXECUTE` para `anon`;
- isolamento (transações somente leitura): admin com sessão viva lê os dados;
  usuário sem papel lê 0 linhas e a RPC o recusa (42501); `anon` sem `EXECUTE`;
  o papel da RPC operacional não acessa `container_services`;
- PostgREST do HML já expõe as tabelas e RPCs da 045 (recusa por permissão para
  `anon`, não "inexistente"), que é o sinal usado pelo app para liberar o
  recurso;
- motor por vigência já estava ligado no HML desde 24/10/2026 (teste com dados
  `HML-TESTE`): a regra V2 da 036 vale para lançamentos novos ou editados.

Regras financeiras (diária, HE, adicionais, sábado, domingo, feriado,
fechamento e faturamento) foram exercitadas pela suíte de compatibilidade no
banco local 045, cujas definições são idênticas às do HML; nenhum teste que
escreve dados foi executado no HML.

Riscos: a 036 muda HE e sábado para lançamentos novos ou editados (decisão do
proprietário de 30/10/2026); a 041 e a 042 nascem desligadas; nunca aplicar a
045 isolada. Production é gate separado, depois da homologação.

### Roteiro de homologação de Containers (navegador, Preview → HML)

Pré-requisitos: schema 045 em HML (cumprido); Preview `dpl_7qDuM37uyJBSCgHvH9E7mjVH4yZU`
(`d6f4186`, código de aplicação igual à `main`) construído com destino HML;
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

- sessão 03: publicar a branch e o PR #98 em Draft; backup cifrado só de HML;
  restauração local descartável; dry-run de 035–045.
- sessão 04: preservar backup e chave em guarda local durável e separada;
  atualizar este checkpoint no PR #98. Nenhuma nuvem autorizada.
- sessão 05: aplicar 035–045 exclusivamente no HML e verificar; nada em
  Production, Vercel, GitHub ou credenciais.

## Proibições

- sem migration em Production; nenhuma nova migration em HML sem autorização;
- sem alteração de Production ou de configuração remota;
- sem merge;
- sem publicar dados do HML, chaves ou caminhos do backup;
- sem regra financeira, Auth, RLS, RPC ou faturamento;
- sem iniciar FIN-PR-12 ou FIN-PR-13.

## Bloqueios e riscos

- backup e chave só existem neste computador: falta cópia fora da máquina
  (chave em gerenciador de senhas; arquivo cifrado em mídia externa ou nuvem
  autorizada), a decidir pelo usuário;
- contas de teste para a homologação ainda não aprovadas (HML: 3 contas, 1 papel
  admin, nenhum fator MFA, nenhuma conta `operacional`); o registro de ativação
  do motor cita dados `HML-TESTE`, mas a natureza de todos os dados não foi
  certificada;
- o Preview é protegido por SSO da Vercel: a navegação exige login do usuário;
- o backup preservado é do estado 034; restaurá-lo agora desfaria a 035–045;
- merge em `main` publica Production antes da CI; contenção administrativa
  pendente na Vercel/GitHub;
- Production roda a interface de Containers sem o schema 045; o recurso fica
  indisponível por desenho, sem homologação.

## Retomada

Sequência preservada: **homologação de Containers (FIN-PR-11) → decisão de
Production → FIN-PR-12 → FIN-PR-13**.

1. Reconciliar Git e GitHub conforme
   [Transferência entre agentes](WORKFLOW.md#reconciliação-na-retomada).
2. Reconfirmar HML na 045 (`migration list`) antes de homologar.
3. Usuário executa o roteiro acima no Preview com conta admin de teste;
   registrar executor, data, deployment, HEAD e migration head.
4. Falha retorna ao Gate 1, sem promover nada. Production 035–045 é gate
   separado, com backup novo de Production.
5. Se houver divergência, atualizar diagnóstico e este checkpoint antes de agir.
