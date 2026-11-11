# Ambientes e vínculos

Inventário factual, sem credenciais, dos ambientes do painel. Cada afirmação traz
o limite da evidência. Mudanças de configuração exigem autorização própria e não
são executadas por este documento.

Atualização de 11/11/2026: Production recebeu 035–050 e o site de `d33e8b2`; vínculos Preview → HML e Production → Production comprovados pela API da Vercel (ver [HANDOFF](HANDOFF.md)). Atualização de 09/11/2026: HML recebeu 046–050. O restante desta página é a verificação de **05/11/2026**, após a aplicação autorizada de 035–045 no HML
(sessão 05), por consultas somente leitura ao GitHub, à API da Vercel (nomes,
escopos e host do Supabase, sem chaves) e à Supabase CLI. A única escrita remota
foi o `db push` no HML.

## Regra de classificação

- `Local`: checkout e Supabase descartável, sem vínculo remoto.
- `CI`: GitHub Actions em VM efêmera, sem secrets remotos.
- `Preview`: deployment Vercel de branch/PR. O backend efetivo precisa ser
  comprovado para cada candidato.
- `HML`: projeto Supabase compartilhado de homologação existente.
- `Production`: domínio real e projeto Supabase de dados reais.

Preview e HML são superfícies diferentes. Um Preview só é homologável quando o
vínculo explícito com o HML autorizado estiver comprovado.

## Matriz vigente

| Ambiente   | Aplicação/Vercel                                                                                    | Supabase                                               | Migration head comprovado            | Situação                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local      | Next.js local                                                                                       | Instância descartável por tarefa                       | Conforme reset local                 | Permitido apenas após comprovar isolamento                                                                                                                  |
| CI         | GitHub Actions, jobs `validar` e `sql-local`                                                        | Supabase local efêmero no job SQL                      | Até a migration versionada no commit | Sem secrets nem vínculo remoto                                                                                                                              |
| Preview    | Deployment automático de branch/PR; URL gerada protegida por Vercel SSO                             | HML `qbnfcmrxmssnwkhaitgd` pela configuração vigente   | 050 (o do HML)                       | Vínculo comprovado em 11/11/2026 (`NEXT_PUBLIC_SUPABASE_URL` de Preview → `qbnfcm…`); homologação das telas feita em localhost → HML (9/9 PASS, 09/11/2026) |
| HML        | Não há domínio Vercel distinto comprovado; pode servir de backend de Preview após vínculo explícito | `bs-logistica-homologacao`, ref `qbnfcmrxmssnwkhaitgd` | 050 — `20261117120000`               | 046–050 aplicadas em 09/11/2026, verificadas (ver HANDOFF)                                                                                                  |
| Production | Vercel `bs-logistica-sistema`, domínio `admin.bslogisticas.com.br`, deploy de `main`                | `bs-logistica-sistema`, ref `ehkduqokntemtmqzdrbd`     | 050 — `20261117120000`               | 035–050 aplicadas em 11/11/2026 (16/16 PASS); site `d33e8b2` (`dpl_ASYPuBYeqaaJZikv5mcdsDsToSbg`)                                                           |

O repositório contém migrations até a **050**
(`20261117120000_050_container_same_day_request.sql`). HML está na 050 desde 09/11/2026 e
Production desde 11/11/2026, com a mesma assinatura de versões
(`01ca91361b85841984ee708716ee60ac`).

## GitHub

| Controle                                 | Estado em 05/11/2026                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Branch padrão                            | `main`                                                                  |
| HEAD verificado                          | `eb8cec9af11c4b0e314296ed776caf15c3764b5f`                              |
| PR #96                                   | Merge squash concluído; head `3897423b23a6f1b358a66a596bf4c843c8d456c3` |
| Proteção de `main`                       | Desabilitada                                                            |
| Rulesets                                 | Nenhum                                                                  |
| Checks obrigatórios                      | Nenhum                                                                  |
| Environments                             | `Preview` e `Production`, sem protection rules                          |
| Actions secrets/variables do repositório | Nenhum nome cadastrado                                                  |

O workflow versionado executa lint, TypeScript, suítes Node, build e SQL local.
Ele não aplica migrations nem publica ambiente remoto.

## Vercel

Projeto `bs-logistica-sistema` (`prj_K1OJ6G7AWnx6dQB1BDsy3HTELnCV`), time
`bslogisticas`, plano Hobby.

Publicações observadas:

| Merge               | Deployment Production              | Pronto (UTC) | CI de `main` concluída (UTC) |
| ------------------- | ---------------------------------- | ------------ | ---------------------------- |
| PR #96 — `eb8cec9…` | `dpl_8kLRFCBVHUeeyM1Rffn5wDsV5nQq` | 10:50:05     | 10:51:57                     |
| PR #97 — `314c08c…` | `dpl_ALDY5SPhRiWMiHW3qr6xDS3s74hk` | 12:14:11     | 12:16:36                     |

Nos dois casos o domínio foi publicado **antes** de a CI de `main` terminar. Após
o PR #97, `admin.bslogisticas.com.br` respondeu 200 com CSP `connect-src`
apontando para `ehkduqokntemtmqzdrbd`. URLs geradas respondem com proteção SSO.

Configurações ainda pendentes de conferência no painel autenticado:

- Production Branch configurada nominalmente;
- `Auto-assign Custom Production Domains`;
- Deployment Checks e responsáveis por promoção.

Até a contenção administrativa, merge e publicação continuam acoplados.

### Variáveis por escopo

Lidas pela API da Vercel em 05/11/2026; registra-se só nome, escopo e o project
ref do host Supabase (público, embutido no bundle), nunca chaves:

| Nome                                   | Preview (todas as branches) | Preview (branch `staging`) | Production             |
| -------------------------------------- | --------------------------- | -------------------------- | ---------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | HML `qbnfcmrxmssnwkhaitgd`  | HML `qbnfcmrxmssnwkhaitgd` | `ehkduqokntemtmqzdrbd` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | presente                    | presente                   | presente               |
| `SUPABASE_SERVICE_ROLE_KEY`            | **ausente**                 | presente (sensitive)       | presente (sensitive)   |
| `PASSWORD_RECOVERY_PROOF_SECRET`       | **ausente**                 | presente (sensitive)       | presente (sensitive)   |
| `SENTRY_AUTH_TOKEN`                    | ausente                     | ausente                    | presente (sensitive)   |
| Flags financeiras `BS_*`               | nenhuma                     | nenhuma                    | nenhuma                |

Limites: é a configuração vigente, aplicada no build; um deployment antigo pode
ter sido construído com valores anteriores (variáveis do Preview atualizadas pela
última vez em 23/10/2026). Não se comparou a chave publicável com o projeto.
Preview de branch comum não tem `service_role` nem segredo de recuperação:
administração de usuários e recuperação de senha só funcionam no Preview da
branch `staging`. Os Containers não dependem dessas variáveis.

O gate em `src/lib/ambiente.ts` impede Preview de usar a referência conhecida de
Production, mas não prova que os dados do HML sejam sintéticos.

## Supabase

- Production e HML são projetos separados, com endpoints e credenciais próprios.
- Ambos estavam `ACTIVE_HEALTHY` na verificação.
- Nenhum projeto possuía Supabase Branches (`branches list` vazio).
- O conteúdo de Auth, a origem dos dados e a presença de dados reais em HML não
  foram inspecionados neste diagnóstico.
- Nenhuma migration, SQL ou configuração foi aplicada durante WORKFLOW-01.
- Backups gerenciados (05/11/2026): `supabase backups list` vazio e PITR
  desligado em HML e em Production. HML tem backup lógico cifrado de 05/11/2026
  (head 034) com restauração local comprovada (ver [HANDOFF](HANDOFF.md)); o
  último backup lógico de Production é de 23/10/2026, anterior à `025` (ver
  [Estado do projeto](ESTADO_DO_PROJETO.md)).

Antes de usar HML para homologação:

1. confirmar dados e identidades permitidos;
2. comprovar backup/recuperação;
3. registrar migration head imediatamente antes da mudança;
4. aplicar 035–045 na ordem, somente com autorização;
5. verificar catálogo, grants, RLS, Auth e compatibilidade;
6. vincular o Preview candidato ao projeto HML e comprovar o vínculo.

## Como revalidar sem expor segredo

- Git/PR/checks: `gh pr view`, `gh run view` e endpoints de deployments;
- GitHub rulesets/environments: consultas REST somente leitura;
- Supabase: `env -u SUPABASE_ACCESS_TOKEN supabase projects list`,
  `branches list` e `migration list` com o project ref explícito;
- Vercel: painel autenticado ou CLI vinculada, registrando somente nomes, escopos,
  project IDs e deployment IDs — nunca valores de credenciais;
- domínio: cabeçalhos HTTP e deployment metadata, sem autenticar usuário real.

Toda revalidação atualiza [ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md) e o
checkpoint em [HANDOFF.md](HANDOFF.md). O procedimento de mudança está em
[WORKFLOW.md](WORKFLOW.md).
