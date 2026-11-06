# Handoff ativo

<!-- workflow-handoff:v1 -->

## Identificação

| Campo                     | Valor                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Etapa                     | FIN-20D-R1 — revisão final dos adicionais                                                                           |
| Gate atual                | Gate 2 — validação local concluída; CI do SHA da R1 e revisão humana; PR Draft #109                                 |
| Último gate concluído     | FIN-20D: CI 42288596515 aprovada em 5b62c9856310efb3efcbd8193e1926a6cf53ed34                                        |
| Worktree                  | /private/tmp/bs-fin-20d                                                                                             |
| Branch                    | fix/fin-20d-idempotencia-adicionais                                                                                 |
| Base                      | PR #108, b7d311f59a2700bc33b2d692a0d2ab8fc5e416c2, migration 046                                                    |
| HEAD validado             | commit da R1 sobre 5b62c9856310efb3efcbd8193e1926a6cf53ed34 (baseline, CI 42288596515); SHA e CI no PR #109         |
| Alterações não commitadas | nenhuma após o commit da R1                                                                                         |
| PR                        | [Draft #109](https://github.com/therunnas/bslogistica/pull/109), empilhado sobre #108                               |
| Ambiente-alvo             | Somente aplicação e Supabase local descartável                                                                      |
| Última ação comprovada    | Validação completa do working tree da R1: lint, tsc, 69 suítes Node, build, 48 suítes SQL e compatibilidade 034–047 |
| Próxima ação exata        | Consultar a CI do SHA publicado e aguardar revisão; Preview/HML exigem gate próprio                                 |

## Evidências

- Baseline confirmado limpo e igual ao HEAD remoto informado pelo usuário.
- Causa: chave somente em memória era descartada ao fechar/recarregar; a 047 interpretava a chave seguinte como outra operação legítima.
- R1 persiste apenas chave UUID e indicador de fallback legado em sessionStorage, com namespace por usuário autenticado. Nenhum valor, motivo, referência, período, payload ou token é persistido.
- Antes de um envio posterior, consulta o registro pela chave sob RLS. Se encontrado, encerra o marcador e interrompe o envio com aviso; outra operação igual exige nova ação explícita. Se ausente na 047, só reutiliza a mesma chave. Erro de leitura não gera chave nem escreve.
- Marcador inválido ou armazenamento indisponível falha fechado. Fechar/reabrir não remove pendências; trava em memória impede envios simultâneos na mesma página.
- A suíte focal (7 testes) cobre commit com resposta perdida, nova instância, reconciliação, nova operação legítima igual, ausência, erro de rede, legado desconhecido, falhas de storage, marcador corrompido, forma persistida (só `chave` e `legado`, por identidade) e o limite de aba nova.
- Ajustes da retomada (RED/GREEN): no fallback legado, toda recusa SQL transacional de `registrar_adicional` (22023, 23505, 23514, 23P01, 28000, 40001, 42501, 55000, P0002) libera nova tentativa; antes só 3 códigos liberavam e um 23505 ou 55000 travava a aba. Desfecho sem código do banco (timeout, rede, gateway, PGRST*, classe 08) segue bloqueando. Marcador corrompido ou de forma inesperada agora falha fechado com a mensagem de reconciliação administrativa, em vez de `SyntaxError`, e não é apagado.
- Validação do working tree da R1 (anterior ao commit): lint, `tsc --noEmit`, 69 suítes `test:*` (incluindo `test:workflow`), `npm run build`, 48 suítes SQL (63 asserções da FIN-20D) e compatibilidade 034/037–047 (97 asserções na 047, incluindo a R1 com commit real e resposta perdida), contra Supabase local descartável `bs-fin20d-local`. Resultado associado ao SHA da R1 apenas se o commit não mudar código depois.
- Evidências anteriores da FIN-20D permanecem no Git; resultados da R1 e CI devem ser associados ao SHA efetivamente publicado.

## Migrations por ambiente

- Migration 047 intacta nesta R1. Nenhuma migration remota.
- Stack local da suíte SQL: bs-fin20d-local, diretório /private/tmp/bs-fin20d-run, schema 047.
- Runner de compatibilidade usa exclusivamente Docker/Supabase local descartável.
- HML/Production não foram acessados nesta R1; estados históricos ficam em [Estado do projeto](ESTADO_DO_PROJETO.md).

## Autorizações

- Corrigir exclusivamente resíduos da FIN-20D, executar testes, commits e atualizar o PR Draft #109.
- Encerrar aguardando revisão.

## Proibições

- Sem merge, migrations remotas, HML, Production ou limpeza de dados.
- Sem alterar regras comerciais, Containers, Apontamentos ou criar módulo financeiro.

## Bloqueios e riscos

- App novo contra 045/046 usa fallback legado: NÃO garante idempotência. O marcador é marcado como legado ANTES dessa chamada. Resultado desconhecido bloqueia novos envios e exige reconciliação administrativa; ausência de linha não prova ausência de commit tardio. Recusas SQL explícitas sem commit permitem corrigir.
- Marcador é por aba/sessão e identidade, seguindo o princípio de Containers. `sessionStorage` cobre fechar o formulário, recarregar e navegar na MESMA aba; NÃO cobre fechar a aba, abrir outra aba ou navegador, nem limpar o armazenamento (teste do limite: aba nova gera chave nova). Nesses casos uma resposta perdida pode ser reenviada como nova operação e duplicar a cobrança; a mitigação é conferir a lista de adicionais antes de repetir. Cobrir esse cenário exigiria `localStorage` ou identificador no servidor, decisão de produto/privacidade fora desta R1. Não limpar marcadores para destravar resultados desconhecidos.
- Homologação real no navegador não é substituída pelos testes automatizados.
- Publicar app antes de migration exige gates e autorização próprios; app antigo contra 047 falha fechado.
- PR #107 é independente; conciliar apenas os documentos ao integrar, sem executar limpeza.

## Retomada

1. Conferir HEAD local/remoto, diff e CI do PR #109 no SHA exato.
2. Revisar a R1 e aguardar decisão do usuário.
3. Preview/HML, implantação e homologação exigem gates próprios; nenhuma autorização inferida.
