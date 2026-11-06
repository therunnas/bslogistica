# Handoff ativo

<!-- workflow-handoff:v1 -->

## Identificação

| Campo                     | Valor                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Etapa                     | FIN-20D-R2 — proteção de intenções entre abas                                                                                   |
| Gate atual                | Gate 2 — validação local concluída; CI do SHA da R2 e revisão humana; PR Draft #109                                             |
| Último gate concluído     | FIN-20D-R1: CI 42302585169 aprovada em c011a71bbc2fb5a43a8124f1ae3126c6fc23347f                                                 |
| Worktree                  | /private/tmp/bs-fin-20d                                                                                                         |
| Branch                    | fix/fin-20d-idempotencia-adicionais                                                                                             |
| Base                      | PR #108, b7d311f59a2700bc33b2d692a0d2ab8fc5e416c2, migration 046                                                                |
| HEAD validado             | c011a71bbc2fb5a43a8124f1ae3126c6fc23347f — baseline da R1 (CI 42302585169); a R2 é o commit seguinte, SHA e CI no PR #109       |
| Alterações não commitadas | nenhuma após o commit da R2                                                                                                     |
| PR                        | [Draft #109](https://github.com/therunnas/bslogistica/pull/109), empilhado sobre #108                                           |
| Ambiente-alvo             | Somente aplicação e Supabase local descartável                                                                                  |
| Última ação comprovada    | R2 validada no working tree: lint, tsc, 69 suítes Node, build, 48 suítes SQL e compatibilidade 034–047 (ver ressalva do runner) |
| Próxima ação exata        | Consultar a CI do SHA publicado e aguardar revisão; Preview/HML exigem gate próprio                                             |

## Evidências

- Baseline confirmado limpo e igual ao HEAD remoto informado pelo usuário.
- Causa: chave somente em memória era descartada ao fechar/recarregar; a 047 interpretava a chave seguinte como outra operação legítima.
- R1 (c011a71): marcador opaco (chave UUID + indicador de fallback legado), namespace por usuário autenticado, reconciliação por chave sob RLS antes de qualquer novo envio, recusas SQL transacionais do legado liberam, desfecho desconhecido bloqueia, marcador corrompido falha fechado.
- Problema da R2: o marcador da R1 estava em `sessionStorage`, que não sobrevive ao fechamento da aba. Uma resposta perdida seguida de aba nova gerava outra chave e duplicava a cobrança.
- R2: o marcador passa para `localStorage` (mesmo conteúdo: só `chave` e `legado`, chave `bs:adicional:intencao:v1:<userId>`), compartilhado entre abas e persistente. A exclusão entre abas usa Web Locks (`navigator.locks`), um lock por usuário, `ifAvailable` (nunca espera) e solto pelo navegador ao fechar a aba. Sem a API, ou se obter o lock falhar, nada é enviado.
- O lock cobre o ciclo inteiro (ler marcador, consultar, enviar, limpar), logo cobre também o duplo clique; a trava em memória da R1 foi removida.
- Nenhum valor, motivo, referência, período, payload ou token é persistido. Containers segue com o próprio marcador em `sessionStorage`, sem alteração. Migration 047 intacta.
- Suíte focal da R2 (9 testes, simulando um navegador com armazenamento e locks compartilhados entre abas), RED 9/9 antes da implementação e GREEN 9/9 depois: aba fechada e reaberta reconcilia sem segundo envio; nova aba simultânea e duplo clique são recusados; aba que fecha com envio em voo reaproveita a MESMA chave; usuários diferentes não compartilham marcador nem lock; sem Web Locks, lock que falha, armazenamento que lança e marcador corrompido falham fechados; registro legítimo novo é possível após reconciliar; legado desconhecido bloqueia também em aba nova; só `chave` e `legado` são gravados; storage apagado não recupera (limite).
- Validação do working tree da R2: lint, `tsc --noEmit`, 69 suítes `test:*`, `npm run build`, 48 suítes SQL e compatibilidade 034/037–047 (97 asserções na 047) contra Supabase local descartável `bs-fin20d-local`.
- Ressalva do runner de compatibilidade: em 3 execuções do runner do repositório houve falhas em cenários diferentes (banco-040, banco-045, banco-041), todas com "Could not find … in the schema cache" do PostgREST logo após o `db reset`, com a máquina sob carga. Com `NOTIFY pgrst, 'reload schema'` e espera após cada reset, aplicado numa cópia do runner fora do repositório, a matriz passou inteira. O runner do repositório não foi alterado; a corrida de cache é instabilidade do ambiente local, não da R2, mas a causa foi inferida por esse comportamento e não isolada além disso.
- Evidências anteriores da FIN-20D e da R1 permanecem no Git.

## Migrations por ambiente

- Migration 047 intacta nesta R2. Nenhuma migration remota.
- Stack local da suíte SQL: bs-fin20d-local, diretório /private/tmp/bs-fin20d-run, schema 047.
- Runner de compatibilidade usa exclusivamente Docker/Supabase local descartável.
- HML/Production não foram acessados nesta R2; estados históricos ficam em [Estado do projeto](ESTADO_DO_PROJETO.md).

## Autorizações

- R2: correção local e pontual, testes, commit e atualização do PR Draft #109.
- Encerrar aguardando revisão.

## Proibições

- Sem merge, migrations remotas, HML, Production ou limpeza de dados.
- Sem alterar regras comerciais, Containers, Apontamentos ou criar módulo financeiro.

## Bloqueios e riscos

- App novo contra 045/046 usa fallback legado: NÃO garante idempotência. O marcador é marcado como legado ANTES dessa chamada. Resultado desconhecido bloqueia novos envios e exige reconciliação administrativa; ausência de linha não prova ausência de commit tardio. Recusas SQL explícitas sem commit permitem corrigir.
- Cobertura da R2: fechar o formulário, recarregar, fechar e reabrir a aba, abrir outra aba do mesmo navegador (inclusive simultânea) e trocar de usuário no mesmo navegador. A garantia é por navegador (origem) e usuário.
- NÃO coberto: outro dispositivo ou navegador, janela anônima, armazenamento do site apagado (manual ou por política do navegador) e navegador sem Web Locks (falha fechado, sem cadastro de adicional). Nesses casos uma resposta perdida pode ser reenviada como nova operação e duplicar a cobrança; mitigação operacional: conferir a lista de adicionais antes de repetir. Cobrir exige persistência no servidor (desenho no relatório da R2, depende de migration 048 e de autorização própria).
- Dois envios legítimos idênticos em abas diferentes, sem pendência, continuam possíveis: sem marcador, o sistema não distingue repetição de nova operação.
- O marcador legado desconhecido ou corrompido agora persiste no navegador até reconciliação: o usuário fica sem registrar adicionais naquele navegador até a remoção manual da chave `bs:adicional:intencao:v1:<userId>` do armazenamento do site, após conferência administrativa. Não existe botão para isso nesta R2. O fallback legado só existe na janela app novo + banco 045/046.
- O marcador permanece no navegador depois do logout (é opaco e por usuário), diferente do conteúdo sanitizado de Containers.
- Homologação real no navegador não é substituída pelos testes automatizados.
- Publicar app antes de migration exige gates e autorização próprios; app antigo contra 047 falha fechado.
- PR #107 é independente; conciliar apenas os documentos ao integrar, sem executar limpeza.

## Retomada

1. Conferir HEAD local/remoto, diff e CI do PR #109 no SHA exato.
2. Revisar a R1 e aguardar decisão do usuário.
3. Preview/HML, implantação e homologação exigem gates próprios; nenhuma autorização inferida.
