# Handoff ativo

<!-- workflow-handoff:v1 -->

Checkpoint curto para retomar o trabalho sem depender de conversa anterior. O
estado factual detalhado permanece em
[ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md), e a fila em
[PROGRESS.md](../PROGRESS.md). Como gravar e reconciliar este checkpoint entre
Codex CLI e Claude Code: [Transferência entre agentes](WORKFLOW.md#transferência-entre-agentes).

## Identificação

| Campo                     | Valor                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Etapa                     | Homologação em HML da integração FIN-PR-11/12/13 (sessões 11 e 12)                                             |
| Gate atual                | Matriz E2E executada em HML: 17 PASS, 8 PARCIAL, 2 BLOQUEADO, 0 FAIL; aguarda decisões e itens de navegador    |
| Último gate concluído     | PR #100 mergeado por squash; CI de `main` verde; matriz de 27 casos executada em HML                           |
| Worktree                  | `/private/tmp/bs-fin-hml`                                                                                      |
| Branch                    | `docs/fin-pr-13-homologacao-hml` (a partir de `origin/main`; commit local, sem push)                           |
| Base                      | `91513b91b11461ac48d8dfe6af118234bfb6fbc0` (`origin/main`, squash do PR #100)                                  |
| HEAD validado             | `91513b91b11461ac48d8dfe6af118234bfb6fbc0` (código); este checkpoint só altera documentação                    |
| Alterações não commitadas | Nenhuma depois do commit documental desta sessão; `.e2e-tmp/` (harness, não versionado) segue ignorado         |
| PR                        | [#100 — mergeado](https://github.com/therunnas/bslogistica/pull/100); sem PR para esta branch documental       |
| Ambiente-alvo             | HML `qbnfcmrxmssnwkhaitgd` (045) com app local; Production `ehkduqokntemtmqzdrbd` (034) só lido, sem alteração |
| Última ação comprovada    | Servidor local encerrado; dados sintéticos `E2E-S11` permanecem em HML; Production na 034 e `/login` 200       |
| Próxima ação exata        | Decidir o risco de Production (código 045 sobre banco 034) e autorizar resolução ON e testes em navegador      |

## Evidências

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
- Sem Preview da Vercel apontado para HML (sem acesso à Vercel). Dynamis continua
  indisponível: E06 BLOQUEADO, sem inferência.

## Migrations por ambiente

- Esta etapa não criou nem aplicou migration.
- HML `qbnfcmrxmssnwkhaitgd`: 045; escritas apenas de dados sintéticos pelas RPCs e
  tabelas da própria aplicação, e uma transação com `ROLLBACK` (último admin).
- Production `ehkduqokntemtmqzdrbd`: 034; apenas leitura do head. Sem backup recente
  (último lógico: 23/10/2026).

## Autorizações

- sessão 11: ready e squash merge do PR #100 condicionados ao HEAD exato;
- sessão 12: proteger Production (rollback só com candidato comprovado), preparar HML
  com identidades e dados sintéticos, executar a matriz de 27 casos e atualizar a
  documentação. Nenhuma foi usada para alterar Production.

## Proibições

- sem migration em Production, dados de Production ou alteração de variáveis de Production;
- sem ligar a resolução comercial em HML sem autorização específica;
- sem e-mails reais, pagamentos externos, dados pessoais reais ou alteração de usuários reais;
- sem inferir regra comercial nem usar R$ 35.118,12 como fixture de outra base.

## Bloqueios e riscos

- **Production roda código 045 sobre banco 034.** Não é novidade desta sessão (vem
  desde o FIN-PR-01), mas o merge em `main` publica antes da CI. Opções: manter
  (a compatibilidade 034 → 045 está testada), conter por rollback na Vercel com
  acesso administrativo, ou preparar 035–045 em Production com backup novo.
- Pendentes por exigirem autorização ou ferramenta: resolução comercial ON (B02, C03
  pagamento ×2, C04), navegador (D04, D05, D09, C05), Microsoft Excel (E03, E04),
  e-mail real (A05) e planilha Dynamis (E06).
- Dados sintéticos em HML, com faturas emitidas (imutáveis), exigem tarefa própria de
  limpeza. Confirmar com a BS a fronteira de arredondamento da HE (achado A).
- Manual de utilização e preparação de Production 035–045 são gates posteriores.

## Retomada

Sequência: **decisão sobre Production → homologação dos itens pendentes (resolução
ON, navegador, Excel, Dynamis) → manual de utilização → preparação controlada de
Production 035–045**.

1. Confirmar `origin/main` em `91513b9` ou posterior e o head de HML (045).
2. Decidir o risco de Production e, se for o caso, executar o rollback com acesso à
   Vercel, registrando o deployment atual para reversão.
3. Obter autorização para ligar a resolução comercial em HML e repetir B02, C03 e C04.
4. Executar no navegador, com credenciais de teste fornecidas pelo responsável, os
   itens de interface e o Excel real; fornecer a Dynamis para E06.
5. Não declarar o projeto finalizado.
