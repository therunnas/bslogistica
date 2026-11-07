# Handoff ativo

<!-- workflow-handoff:v1 -->

**Fonte principal do estado atual. RELEASE-PREVIEW-01, 07/11/2026. Integração LOCAL, sem publicação.**
SDLC: Testes / integração para homologação manual. Objetivo: um único Preview com #106 + #108/#109/#110.

## Identificação

| Campo                     | Valor                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Etapa                     | RELEASE-PREVIEW-01 — integração local de #106 e #108/#109/#110 para um Preview único                                                                         |
| Gate atual                | Gate 2 — validação local da integração em andamento; Preview ainda não publicado                                                                             |
| Último gate concluído     | CI aprovada nos insumos: #110 `877e06a111fed1dfc48ae1d1114d4063e47a6d2b` e #106 `5246e8d26a55fbecbdd1e0c711cf7ac673bcc439`                                   |
| Worktree                  | `/private/tmp/bs-fin-20d`                                                                                                                                    |
| Branch                    | `integracao/release-preview-01` (somente local, sem upstream)                                                                                                |
| Base                      | `main` `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`                                                                                                            |
| HEAD validado             | `877e06a111fed1dfc48ae1d1114d4063e47a6d2b` (#110) e `5246e8d26a55fbecbdd1e0c711cf7ac673bcc439` (#106), cada um com CI própria; a integração ainda não tem CI |
| Alterações não commitadas | conferir `git status`; resultados da validação local entram no commit seguinte                                                                               |
| PR                        | nenhum para a integração; insumos #106, #108, #109 e #110 em Draft, inalterados                                                                              |
| Ambiente-alvo             | Local × Supabase local descartável; Preview e HML só com autorização própria                                                                                 |
| Última ação comprovada    | Merges locais sem conflito de código; conflitos só em PROGRESS, ESTADO e HANDOFF, resolvidos                                                                 |
| Próxima ação exata        | Concluir lint, TypeScript, suítes Node, build, SQL e compatibilidade; depois pedir autorização de push                                                       |

## Evidências

- Integração: `main` + cadeia #108→#109→#110 (046, 047, QA-20D) + #106 (correções da sessão 19).
  #107 (runbook e script do expurgo do HML) fica **fora** da aplicação.
- Código (`src/`) sem arquivos em comum entre #106 e a cadeia; `ci.yml` e `package.json` mesclados automaticamente.
- Livro da sessão 19 herdado do #106: [livro dos controles](continuidade/controles-sessao-19.json) e
  [matriz](homologacao-sessao-19.md) (283 PASS / 0 FAIL / 64 BLOQUEADO / 137 NÃO TESTADO; homologação NO-GO).
- Resultados da validação desta integração: **pendentes**.

## Migrations por ambiente

- Repositório integrado: até a **047** (`20261114120000`).
- HML `qbnfcmrxmssnwkhaitgd`: 50 migrations, head **045** (último registro comprovado em 07/11/2026, leitura).
  046 e 047 **não** aplicadas; o app integrado usa o caminho compatível com 045/046 (registro de adicional sem
  idempotência) até a 047 existir no banco.
- Production: 034, fora do escopo. [Inventário histórico](AMBIENTES.md).

## Autorizações

RELEASE-PREVIEW-01: inspeção, branch local de integração, correções nela, build, lint, TypeScript e testes
seguros, preparação do Preview e roteiro manual.

## Proibições

Sem push sem revisão, merge em `main`, deploy em Production, migrations remotas, expurgo de dados, reset de
stacks de outras sessões, novo Supabase, alteração dos PRs originais ou das regras financeiras aprovadas.

## Bloqueios e riscos

- Publicar o Preview exige push da branch (gera deploy Preview automático na Vercel): **autorização pendente**.
- Idempotência de adicionais só vale com a 047 no HML; até lá, homologar adicionais sabendo que reenvio após
  resposta perdida bloqueia e exige conferência (caminho legado).
- Expurgo do HML, 046/047 no HML e cópia independente dos backups seguem com gates próprios
  (inventário de backups mantido fora do repositório, no Mac do responsável técnico).

## Retomada

1. `git switch integracao/release-preview-01` no worktree acima e conferir `git log` e `git status`.
2. Rever os resultados da validação neste HANDOFF.
3. Publicar o Preview só com autorização explícita de push; depois conferir o deploy pelo SHA exato.
