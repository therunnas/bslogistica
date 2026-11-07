# Handoff ativo

<!-- workflow-handoff:v1 -->

## Identificação

| Campo                     | Valor                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Etapa                     | QA-20D-R1 — hardening final do runner de compatibilidade (manutenção de teste, sem código de produto)                                                             |
| Gate atual                | Gate 2 — validação local concluída; CI do SHA da QA-20D-R1 e revisão humana; PR Draft #110, empilhado sobre #109                                                  |
| Último gate concluído     | QA-20D: CI 42326348510 aprovada em 348d575709141a66a64ab785b6bd628fbc358202                                                                                       |
| Worktree                  | /private/tmp/bs-fin-20d                                                                                                                                           |
| Branch                    | qa/qa-20d-estabilidade-compat                                                                                                                                     |
| Base                      | PR #109, c530da28ba5f05462139ac9f0cc767b919c2f249 (FIN-20D-R2, migration 047)                                                                                     |
| HEAD validado             | 348d575709141a66a64ab785b6bd628fbc358202 — QA-20D (CI 42326348510); a R1 é o commit seguinte, SHA e CI no PR #110                                                 |
| Alterações não commitadas | nenhuma após o commit da QA-20D-R1                                                                                                                                |
| PR                        | [Draft #110](https://github.com/therunnas/bslogistica/pull/110), empilhado sobre [#109](https://github.com/therunnas/bslogistica/pull/109); #109 não foi alterado |
| Ambiente-alvo             | Somente aplicação e Supabase local descartável                                                                                                                    |
| Última ação comprovada    | QA-20D-R1: RED/GREEN do canário e do destino, provas na stack isolada e matriz 034–047 aprovada com o runner endurecido                                           |
| Próxima ação exata        | Consultar a CI do SHA publicado e aguardar revisão; depois, retomar o gate de Preview/HML da FIN-20D com autorização própria                                      |

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
- QA-20D (runner de compatibilidade): cada `db reset --local` passa por `resetar`, que chama `scripts/_aguardar_postgrest.py`: canário criado depois do reset, `NOTIFY pgrst, 'reload schema'` repetido a cada 10 s, liberação só com HTTP 200 da RPC do canário pelo cache do PostgREST, desistência em 90 s com última resposta e logs. Sem espera fixa. O OpenAPI da raiz não serve como sinal (lista objetos novos com o cache das requisições defasado).
- Causa das falhas da R2: a mensagem vem do cache de schema do PostgREST (comprovado com os triggers de recarga desativados); o gatilho exato não foi reproduzido. Em 48 resets a recarga levou de 2 a 10 chamadas em 17 casos, com cauda de 6,1 s.
- QA-20D-R1, riscos fechados com RED/GREEN:
  - Canário de nome fixo dava falso "pronto": com a recarga desativada, o canário recriado respondia 200 (assinatura ainda no cache) enquanto um objeto pós-reset respondia PGRST202. Agora o nome é único por execução (`_qa_pgrst_canario_<16 hex>`), executável só por `authenticated` (revogado de PUBLIC, anon e service_role), removido sempre (também em SIGTERM/SIGINT) junto com sobras de execuções mortas; "pronto" exige também a contagem zero de canários no banco.
  - Destino: o verificador antigo seguia redirecionamento 303 e enviava `apikey` e `Authorization` ao destino do redirecionamento (reproduzido). Agora a URL passa por parsing estrito (só `http://127.0.0.1|localhost:<1–65535>`, sem credenciais, caminho, query ou fragmento) antes de qualquer requisição, o transporte recusa redirecionamento e ignora proxy do ambiente.
  - Alvo: o runner exige `SUPABASE_WORKDIR` com project_id diferente do `config.toml` do repositório (compartilhado por todos os worktrees) e, antes de exportar chaves ou resetar, `--verificar-alvo` casa API, porta publicada pelo Kong, rótulos `com.supabase.cli.project`/`workdir` de `supabase_db_<id>` e `supabase_kong_<id>`. O modo de espera refaz essa conferência antes de qualquer SQL.
- Incidente durante a R1: um caso de teste manual chamou o modo de espera ainda sem essa conferência com o container `supabase_db_ehkduqokntemtmqzdrbd` (stack local de outra sessão). O verificador criou e removeu um canário naquele banco, enviou NOTIFY de recarga e leu os logs do PostgREST dela. Não houve reset nem dado de negócio tocado; conferido depois, só leitura: 0 canários restantes e containers saudáveis. A falha que permitiu isso está corrigida e coberta por teste (recusa antes de qualquer SQL).
- Evidência da R1: `test:calendario-runners` 23/23 (4 testes novos do verificador falham contra a versão 348d575); provas na stack `bs-fin20d-local`: dois resets consecutivos com nomes distintos, cache defasado com recarga desativada, prazo (exit 1) e SIGTERM (exit 143) com canário removido, recusas de workdir/porta/credencial; matriz 034/037–047 aprovada (12 canários distintos, 0 restantes).
- Pendência separada, fora desta tarefa: `scripts/testar-sql-local.sh` ainda usa o project_id do `config.toml` do repositório e pode resetar a stack local de outra sessão; precisa da mesma exigência de workdir próprio.

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
