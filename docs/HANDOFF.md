# Handoff ativo

<!-- workflow-handoff:v1 -->

Checkpoint da sessão 19. Evidências e matriz completa em
[Homologação integral](homologacao-sessao-19.md).

## Identificação

| Campo                     | Valor                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Etapa                     | Testes: homologação integral, com correção visual local                                                                                   |
| Gate atual                | Homologação BLOQUEADA; correção ainda sem Preview                                                                                         |
| Último gate concluído     | Baseline, suítes locais e cenários Auth/RLS/MFA/API/financeiro executados                                                                 |
| Worktree                  | `/private/tmp/bs-session-19`                                                                                                              |
| Branch                    | `fix/session-19-dashboard-currency`                                                                                                       |
| Base                      | `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`                                                                                                |
| HEAD validado             | `38b43490a8e0913c62a4ee6047ef48a8288ca0dc` + working tree; hashes do código em `/private/tmp/bs-session-19-evidence/candidate-files.json` |
| Alterações não commitadas | Dashboard, teste de moeda, package.json, CI, PROGRESS, ESTADO_DO_PROJETO, este HANDOFF e matriz S19                                       |
| PR                        | Nenhum; sem commit/push/publicação                                                                                                        |
| Ambiente-alvo             | Local inerte e app local ligado exclusivamente ao HML; staging observado por Chrome; Production intocada                                  |
| Última ação comprovada    | API real conciliou Cliente A e gerou os dois XLSX; identidades próprias testadas com JWT/TOTP reais                                       |
| Próxima ação exata        | Resolver candidato visual e sessão sintética de navegador para concluir os cenários por módulo                                            |

## Evidências

- Matriz por módulo, contagens, falhas e limites em [Homologação integral](homologacao-sessao-19.md).
- Diretório local sanitizado: `/private/tmp/bs-session-19-evidence`; sem senhas, tokens ou chaves gravadas.
- `test-hml-auth.py` cria novas identidades: **não repetir automaticamente**.
- `test-app-hml.py` encerrou o próprio servidor 3201 ao terminar. O servidor inerte 3199 foi encerrado pelo prazo de 900 s do runner.
- As 27 rotas foram alcançadas por HTTP em cenários sem sessão/públicos; isso não aprova seus fluxos autenticados.
- CI da base e provas históricas de SQL/Excel não foram chamadas de CI da correção ou de execução S19 no staging.

## Migrations por ambiente

- HML `qbnfcmrxmssnwkhaitgd`: `20261112120000` (045), 50 migrations, leitura READ ONLY nesta sessão.
- Production: 034 conforme usuário/documentação recente; sem consulta nem alteração S19.
- Nenhuma migration criada/aplicada e nenhuma flag comercial alterada.

## Autorizações

O usuário autorizou investigação, testes, dados sintéticos descartáveis e correções
em branches isoladas. Foram criadas somente quatro identidades S19 e suas relações
de acesso/fator; IDs e escopo na matriz. Leituras de faturamento/fechamento não
alteraram o histórico. A consulta técnica usou somente chaves HML verificadas em memória.

## Proibições

Sem escrita/migration em Production, credenciais reais alteradas, exclusão de dados
existentes, mudança de regra comercial, merge ou deploy remoto não aprovado.
Sem commit/push/PR sem aval específico. Não usar a sessão pessoal aberta no Chrome
para mutações, logout, papel ou MFA.

## Bloqueios e riscos

- Turbopack local sem build aprovado (porta interna EPERM, mesmo escalonado).
- Build diagnóstico Webpack compilou, mas seu cliente falhou por variáveis públicas ausentes no bundle. O backend foi testado de fato, sem afirmar hidratação PASS.
- Falta a sessão sintética no navegador de staging e a execução completa dos formulários, filtros, paginação, recarga, erros e responsividade.
- Templates/entrega/expiração de convite e recuperação remotos continuam sem prova nesta sessão.
- A correção monetária não foi publicada; o sintoma permanece no staging.
- Não remover as identidades novas nem registros antigos faturados; limpeza exige escopo próprio.

## Retomada

1. Confirmar branch/HEAD, diff e hashes do código; preservar este working tree e o checkout original.
2. Ler a matriz S19, não reiniciar auditorias históricas válidas.
3. Resolver os bloqueios visuais e executar apenas a cobertura faltante.
4. Revisar a correção local e obter o gate específico antes de commit/push/PR/publicação.
5. Concluir a homologação somente com todos os cenários críticos aprovados.
