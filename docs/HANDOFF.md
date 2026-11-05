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
| Gate atual                | Gate 4 — preparação de HML: diagnóstico somente leitura concluído; aguarda autorização |
| Último gate concluído     | Gate 6 e Gate 8 de WORKFLOW-01 — PR #97 integrado e encerrado                          |
| Worktree                  | `/private/tmp/bs-workflow-01`                                                          |
| Branch                    | `docs/fin-pr-11-preparacao-hml` (só documentação; sem push)                            |
| Base                      | `314c08cb20e9a32dd10b4a0665e1be7dad108264` (`origin/main`)                             |
| HEAD validado             | `314c08cb20e9a32dd10b4a0665e1be7dad108264` (`main`); CI run 42025322827 verde          |
| Alterações não commitadas | Nenhuma; o commit local desta branch contém só documentação e o validador documental   |
| PR                        | Nenhum aberto para esta branch; PR #97 mergeado                                        |
| Ambiente-alvo             | HML `qbnfcmrxmssnwkhaitgd` e Preview ligado a ele, somente após autorização            |
| Última ação comprovada    | Merge `314c08c`; diagnóstico de HML, Production, Preview e backup sem mutação          |
| Próxima ação exata        | Pedir autorização para backup restaurável de HML e, depois, migrations 035–045 em HML  |

## Evidências

- PR #97 mergeado por squash em `314c08c` às 12:13:27 UTC, condicionado ao head
  `3427d1c` com CI verde. CI de `main` no merge: `validar` e `sql-local` verdes.
- Production `dpl_ALDY5SPhRiWMiHW3qr6xDS3s74hk` (`314c08c`) pronto às 12:14:11
  UTC, antes da CI de `main` (12:16:36). Domínio 200, CSP com Supabase Production.
- HML e Production `ACTIVE_HEALTHY`, histórico idêntico até a 034, sem migration
  só remota; 035–045 pendentes nos dois.
- `supabase backups list`: vazio e PITR desligado nos dois projetos.
- API da Vercel: Preview (todas as branches e `staging`) → HML; Production →
  Production. Preview genérico sem `service_role` e sem segredo de recuperação.
- Containers não usam `service_role`; funcionam no Preview genérico.
- Commit local desta branch: `PADRAO_DE_PROMPTS.md` novo, referências e estado
  atualizados. RED do validador na árvore de `main` (3 erros esperados) antes do
  GREEN; validação local registrada no relatório da sessão que o criou.

## Migrations por ambiente

- Local/CI: 001–045 versionadas e testadas em instâncias descartáveis.
- HML `qbnfcmrxmssnwkhaitgd`: 034 (`20261101120000`).
- Production `ehkduqokntemtmqzdrbd`: 034 (`20261101120000`).

### Plano para HML (não executado)

1. Autorização nominal: HML, ref `qbnfcmrxmssnwkhaitgd`, migrations 035–045.
2. `CHECK-UP-REC-01`: dump lógico de HML (schemas e dados), cifrado, com hash
   registrado, restaurado em Supabase local descartável e conferido por contagem
   de linhas e catálogo. Sem isso, não seguir.
3. Reconfirmar o head 034 imediatamente antes, com `env -u SUPABASE_ACCESS_TOKEN`
   e sem o `SUPABASE_PROJECT_ID` do `.env` no ambiente.
4. O `dry-run` deve listar exatamente as 11 migrations, de `20261102120000` a
   `20261112120000`, nesta ordem; qualquer outra lista bloqueia.
5. Aplicar 035–045 em sequência única. Dependências declaradas: 035 a 039
   aplicadas juntas; depois 040 → 041 → 042 → 043 → 044 → 045. Falha interrompe;
   reversão só pelos runbooks de [runbooks/README.md](runbooks/README.md), com
   autorização.
6. Verificar histórico (045), tabelas `container_*` com RLS, as RPCs
   `registrar_servico_container` e `cancelar_servico_container`, donos e grants de
   `bslog_rpc_operacional` inalterados e nenhum valor existente recalculado.
7. Registrar o novo head aqui e em [AMBIENTES.md](AMBIENTES.md).

Riscos: a 036 muda HE e sábado para lançamentos novos ou editados (decisão do
proprietário de 30/10/2026); a 041 e a 042 nascem desligadas; nunca aplicar a
045 isolada. Production é gate separado, depois da homologação.

### Roteiro de homologação de Containers (navegador, Preview → HML)

Pré-requisitos: schema 045 em HML; Preview do HEAD candidato confirmado em HML;
conta `admin` de teste e, para o item 1, conta `operacional` de teste aprovadas.

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

Testes automatizados (CI e SQL local) não substituem nenhum item acima.

## Autorizações

- vigentes nesta sessão: inspeção somente leitura de GitHub, Vercel, Supabase HML
  e Production, documentação e commit local de documentação.

## Proibições

- sem migration, SQL de escrita, backup/restauração remota ou mudança de
  configuração sem autorização nominal;
- sem alteração de Production;
- sem push ou PR desta branch sem autorização;
- sem regra financeira, Auth, RLS, RPC ou faturamento;
- sem iniciar FIN-PR-12 ou FIN-PR-13.

## Bloqueios e riscos

- backup restaurável de HML inexistente (`CHECK-UP-REC-01`);
- identidades de teste e natureza dos dados de HML (sintéticos ou não) não
  conferidas;
- merge em `main` publica Production antes da CI; contenção administrativa
  pendente na Vercel/GitHub;
- Production roda a interface de Containers sem o schema 045; o recurso fica
  indisponível por desenho, sem homologação.

## Retomada

Sequência preservada: **preparação de HML → homologação de Containers
(FIN-PR-11) → FIN-PR-12 → FIN-PR-13**. WORKFLOW-01 está encerrada.

1. Reconciliar Git e GitHub conforme
   [Transferência entre agentes](WORKFLOW.md#reconciliação-na-retomada).
2. Publicar esta branch só com autorização (push e PR documental).
3. Com autorização, executar o plano de HML acima, um passo por vez.
4. Homologar Containers pelo roteiro; registrar executor, data, HEAD, deployment
   e migration head.
5. Se houver divergência, atualizar diagnóstico e este checkpoint antes de agir.
