# Handoff ativo

<!-- workflow-handoff:v1 -->

Checkpoint curto para retomar o trabalho sem depender de conversa anterior. O
estado factual detalhado permanece em
[ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md), e a fila em
[PROGRESS.md](../PROGRESS.md). Como gravar e reconciliar este checkpoint entre
Codex CLI e Claude Code: [Transferência entre agentes](WORKFLOW.md#transferência-entre-agentes).

## Identificação

| Campo                     | Valor                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Etapa                     | Fechamento pré-Production (sessão 16)                                                                                                                                                         |
| Gate atual                | Ensaio 034 → 045 e backup restaurado concluídos; parecer NO-GO condicional (4 itens não técnicos)                                                                                             |
| Último gate concluído     | PR #104 mergeado em `071ea6d`; ensaio integral 034 → 045 sobre o banco restaurado, sem erro                                                                                                   |
| Worktree                  | `/private/tmp/bs-fin-hml`                                                                                                                                                                     |
| Branch                    | `docs/sessao-14-manual-e-producao` (PR #103); margem do Fechamento/Faturamento em `fix/margem-containers-faturamento-fechamento` (PR #105)                                                    |
| Base                      | `e7f77b02a63e433247e7c04a07ed335e7c602b57` (`origin/main`, squash do PR #101)                                                                                                                 |
| HEAD validado             | `e7f77b02a63e433247e7c04a07ed335e7c602b57` (main); esta etapa só altera documentação                                                                                                          |
| Alterações não commitadas | Nenhuma depois do commit documental desta sessão; `.e2e-tmp/` (harness, não versionado) segue ignorado                                                                                        |
| PR                        | [#103](https://github.com/therunnas/bslogistica/pull/103) docs e [#105](https://github.com/therunnas/bslogistica/pull/105) margem, abertos, sem merge automático; #101, #102 e #104 mergeados |
| Ambiente-alvo             | Production (034) só lida e copiada (dump); HML e stacks locais isoladas; nada aplicado                                                                                                        |
| Última ação comprovada    | Banco restaurado migrado 034 → 045 (11 migrations, ~2,5 s), catálogo = HML, reversão ensaiada até 034                                                                                         |
| Próxima ação exata        | Segunda cópia do backup; conferir e-mails no Dashboard; revisar #103/#105; só então pedir autorização da janela                                                                               |

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
- Sessão 13: resolução comercial ligada em HML só durante B02, C03 e C04 e restaurada
  para OFF (verificado). Navegador real (Chrome): C05, D04, D05, D09 e fluxos de
  recuperação. Microsoft Excel real (AppleScript): E03 e E04, com filtros aplicados.
  A05: papel e auditoria pela interface; recuperação sem MFA e com um TOTP. Regra da HE
  (15 → 30, 45 → 60) aprovada e corrigida em `ARQUITETURA.md`. Resultado 25/1/1/0.
- Sem Preview da Vercel apontado para HML (sem acesso à Vercel). Dynamis continua
  indisponível: E06 BLOQUEADO, sem inferência.

- Sessão 14: PR #101 mergeado por squash em `e7f77b0` (CI verde no HEAD `1371f07`; só
  documentação). A05 fechado em stack local isolada com captura de e-mail; E06 executado com
  a planilha Dynamis (SHA-256 `2b211d4c…18f7`, comparação por componente, sem paridade);
  achado G explicado sem alterar código; H corrigido no PR #102 (rótulos "fim exclusivo");
  novo achado I (margem do Dashboard sem custo de Containers) e dependência J (modelo de e-mail
  do convite). Manual de uso e plano 034 → 045 redigidos.

- Sessão 15: PR #102 mergeado (`b63d33b`). Achado I corrigido no PR #104 (custo de Containers
  na margem do Dashboard e dos Relatórios; 67/67 suítes, lint e tsc). Manual corrigido
  (Presente/Falta/Substituição; Faturamento; Relatórios) e runbook corrigido (os scripts
  `comparar-catalogo-*.sh` só operam no local). Config de Auth de HML e Production lida por
  `supabase config pull --dry-run` (nada gravado). **Backup novo de Production** em
  `~/bs-backups-producao/2026-11-05-034/` (cifrado, senha no Chaveiro) com restauração local
  comprovada; Production não tem dados de negócio.

- Sessão 16: #104 corrigido para o schema 034 (defeito medido no PostgREST real sobre o backup) e
  mergeado (`071ea6d`); margem total no Fechamento e no Faturamento no PR #105; backup verificado e
  restaurado (Auth funcional); ensaio integral 034 → 045 e reversão; checklists de e-mail e backup.
  Parecer: NO-GO condicional (runbook, seção 11).

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
- Pendências reais: revisão humana dos PRs #103 e #104; **segunda cópia** do backup em outro
  local protegido; conferir no Dashboard do Supabase os **modelos de e-mail** de convite e
  recuperação, a **expiração** do link e a autenticação do domínio de envio (ver runbook, 1.2);
  decisão e autorização para implantar 035–045 em Production, com dump novo se houver escrita.
- Dados sintéticos em HML, com faturas emitidas (imutáveis), exigem tarefa própria de
  limpeza. Regra de arredondamento da HE aprovada e documentada na sessão 13.
- Manual de utilização e preparação de Production 035–045 são gates posteriores.

## Retomada

Sequência: **decisão sobre Production → homologação dos itens pendentes (convite,
Dynamis) → manual de utilização → preparação controlada de
Production 035–045**.

1. Confirmar `origin/main` em `91513b9` ou posterior e o head de HML (045).
2. Decidir o risco de Production e, se for o caso, executar o rollback com acesso à
   Vercel, registrando o deployment atual para reversão.
3. Revisão humana da matriz, do [manual](MANUAL_DE_USO.md) e do
   [plano de Production](runbooks/producao-034-045.md); decidir o achado I e o PR #102.
4. Confirmar os modelos de e-mail do Dashboard de HML e Production (checklist no runbook).
5. Não declarar o projeto finalizado.
