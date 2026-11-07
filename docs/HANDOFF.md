# Handoff ativo

<!-- workflow-handoff:v1 -->

## Identificação

| Campo                     | Valor                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Etapa                     | QA-20D — estabilidade do runner de compatibilidade (manutenção de teste, sem código de produto)                                                 |
| Gate atual                | Gate 2 — validação local concluída; CI do SHA da QA-20D e revisão humana; PR Draft próprio, empilhado sobre #109                                |
| Último gate concluído     | FIN-20D-R2: CI 42312206955 aprovada em c530da28ba5f05462139ac9f0cc767b919c2f249                                                                 |
| Worktree                  | /private/tmp/bs-fin-20d                                                                                                                         |
| Branch                    | qa/qa-20d-estabilidade-compat                                                                                                                   |
| Base                      | PR #109, c530da28ba5f05462139ac9f0cc767b919c2f249 (FIN-20D-R2, migration 047)                                                                   |
| HEAD validado             | c530da28ba5f05462139ac9f0cc767b919c2f249 — baseline da QA-20D (CI 42312206955); a QA-20D é o commit seguinte, SHA e CI no PR Draft da branch    |
| Alterações não commitadas | nenhuma após o commit da QA-20D                                                                                                                 |
| PR                        | Draft da branch qa/qa-20d-estabilidade-compat, empilhado sobre [#109](https://github.com/therunnas/bslogistica/pull/109); #109 não foi alterado |
| Ambiente-alvo             | Somente aplicação e Supabase local descartável                                                                                                  |
| Última ação comprovada    | Série de compatibilidade 034–047: runner antigo 3/3 e novo 5/5 aprovados na stack local isolada; suítes afetadas, lint e tsc                    |
| Próxima ação exata        | Consultar a CI do SHA publicado e aguardar revisão; depois, retomar o gate de Preview/HML da FIN-20D com autorização própria                    |

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
- QA-20D (runner de compatibilidade): cada `db reset --local` passa por `resetar`, que chama `scripts/_aguardar_postgrest.py`. O verificador cria um canário `public._qa_pgrst_canario()` depois do reset, envia `NOTIFY pgrst, 'reload schema'` (repetido a cada 10 s) e só libera quando a RPC do canário responde 200 pelo cache do PostgREST; remove o canário sempre e desiste em 90 s com última resposta e logs do PostgREST. Sem espera fixa. Só aceita API 127.0.0.1/localhost e container `supabase_db_*`; `SUPABASE_WORKDIR` opcional aponta para uma stack local própria, e o runner imprime project_id, container e API antes de começar.
- Causa: a mensagem vem do cache de schema do PostgREST (comprovado: com os triggers de recarga desativados, a RPC nova devolve PGRST202 por mais de 5 s). O gatilho exato das 3 falhas da R2 NÃO foi reproduzido: 6 resets isolados e 3 execuções completas do runner antigo passaram. Evidência a favor da hipótese: em 48 resets o canário precisou de 2 a 10 chamadas em 17 casos, com cauda de até 6,1 s de recarga, tempo suficiente para os primeiros testes do runner antigo encontrarem o cache defasado.
- Uma primeira versão do verificador comparava o catálogo com o OpenAPI da raiz e foi descartada: a raiz lista objetos novos mesmo com o cache das requisições defasado, então daria falso "pronto".
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
