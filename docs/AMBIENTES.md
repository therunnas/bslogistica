# Ambientes e vínculos

Inventário factual, sem credenciais, dos ambientes do painel. Cada afirmação traz
o limite da evidência. Mudanças de configuração exigem autorização própria e não
são executadas por este documento.

Última verificação: **05/11/2026**, durante WORKFLOW-01, por consultas somente
leitura ao GitHub, Vercel HTTP/GitHub Deployments e Supabase CLI.

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

| Ambiente   | Aplicação/Vercel                                                                                    | Supabase                                               | Migration head comprovado            | Situação                                                     |
| ---------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------ |
| Local      | Next.js local                                                                                       | Instância descartável por tarefa                       | Conforme reset local                 | Permitido apenas após comprovar isolamento                   |
| CI         | GitHub Actions, jobs `validar` e `sql-local`                                                        | Supabase local efêmero no job SQL                      | Até a migration versionada no commit | Sem secrets nem vínculo remoto                               |
| Preview    | Deployment automático de branch/PR; URL gerada protegida por Vercel SSO no PR #96                   | Destino exato do último Preview **não comprovado**     | Não comprovado                       | Existe, mas homologação real continua pendente               |
| HML        | Não há domínio Vercel distinto comprovado; pode servir de backend de Preview após vínculo explícito | `bs-logistica-homologacao`, ref `qbnfcmrxmssnwkhaitgd` | 034 — `20261101120000`               | Projeto distinto de Production; migrations 035–045 pendentes |
| Production | Vercel `bs-logistica-sistema`, domínio `admin.bslogisticas.com.br`, deploy de `main`                | `bs-logistica-sistema`, ref `ehkduqokntemtmqzdrbd`     | 034 — `20261101120000`               | Frontend do PR #96 publicado; schema 045 indisponível        |

O repositório contém migrations até a **045**
(`20261112120000_045_container_servico.sql`). Em HML e Production, a listagem
remota de migrations terminou na 034. Logo, 035–045 precisam de reconciliação e
implantação controlada; não aplicar somente a 045 fora da sequência.

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

Evidências do PR #96:

- Preview `7561695754`, head `3897423b…`: `success` em 05/11/2026 00:29:27 UTC;
- Production `7571578582`, merge `eb8cec9…`: `success` em 05/11/2026 10:50:07 UTC;
- CI de `main` terminou depois, às 10:51:57 UTC;
- o domínio Production indicou na CSP o projeto Supabase de Production;
- URLs geradas de Preview e Production responderam com proteção SSO da Vercel.

Configurações ainda pendentes de conferência no painel autenticado:

- nomes e escopos efetivos das variáveis Preview/Production;
- destino Supabase do Preview vigente;
- Production Branch configurada nominalmente;
- `Auto-assign Custom Production Domains`;
- Deployment Checks e responsáveis por promoção.

O comportamento observado comprova que o merge em `main` publicou o domínio de
Production automaticamente. Até a contenção administrativa, merge e publicação
continuam acoplados.

### Variáveis esperadas por nome

Sem registrar valores:

| Nome                                   | Preview                                          | Production                      | Observação                                  |
| -------------------------------------- | ------------------------------------------------ | ------------------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Deve apontar ao projeto de teste autorizado      | Projeto Production              | Escopo real pendente de auditoria           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave publicável do mesmo projeto Preview/HML    | Chave publicável Production     | Não é segredo, mas não versionar valores    |
| `SUPABASE_SERVICE_ROLE_KEY`            | Ausente salvo necessidade aprovada e server-side | Server-side                     | Nunca `NEXT_PUBLIC_*`; escopo real pendente |
| `SENTRY_AUTH_TOKEN` e DSN relacionados | Não necessários para envio fora de Production    | Conforme integração server-side | Não revelar valores                         |
| Flags financeiras `BS_*`               | Desligadas por padrão                            | Desligadas até autorização      | Ativação é gate separado                    |

O gate em `src/lib/ambiente.ts` impede Preview de usar a referência conhecida de
Production, mas não prova sozinho que o destino seja HML nem que os dados sejam
sintéticos.

## Supabase

- Production e HML são projetos separados, com endpoints e credenciais próprios.
- Ambos estavam `ACTIVE_HEALTHY` na verificação.
- Nenhum projeto possuía Supabase Branches (`branches list` vazio).
- O conteúdo de Auth, a origem dos dados e a presença de dados reais em HML não
  foram inspecionados neste diagnóstico.
- Nenhuma migration, SQL ou configuração foi aplicada durante WORKFLOW-01.

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
