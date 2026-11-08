# Fluxo de desenvolvimento e publicação

Processo normativo único para ChatGPT, Codex CLI, Claude Code e pessoas que
trabalham neste repositório. O fluxo protege a continuidade entre sessões sem
reabrir decisões aprovadas nem transformar documentação em autorização.

O inventário factual dos ambientes fica em [AMBIENTES.md](AMBIENTES.md), o
estado atual e checkpoint principal em [HANDOFF.md](HANDOFF.md), o histórico em
[ESTADO_DO_PROJETO.md](ESTADO_DO_PROJETO.md) e a fila de trabalho em
[PROGRESS.md](../PROGRESS.md). O formato obrigatório dos prompts de sessão está em
[PADRAO_DE_PROMPTS.md](PADRAO_DE_PROMPTS.md); ele delimita a autorização da
sessão, mas não dispensa nenhum gate deste documento.

## Princípios obrigatórios

1. Existe **uma tarefa de implementação ativa por vez**. As demais ficam na fila
   ou pausadas com motivo em `PROGRESS.md`.
2. Cada tarefa começa em branch isolada criada da `origin/main` revalidada.
3. Código no Git, CI verde, deploy do aplicativo, migration aplicada e regra
   ativada são estados diferentes e devem ser registrados separadamente.
4. CI verde comprova o candidato no escopo automatizado; **não é homologação**.
5. Merge integra código; **não autoriza migration, ativação ou Production**.
6. Preview nunca usa banco, Auth ou credencial de Production.
7. Nenhuma autorização é herdada de outra etapa. Aprovação de branch, Docker,
   Preview ou merge não autoriza Production.
8. Toda evidência identifica ambiente, commit e data. Evidência de outro SHA ou
   ambiente não é transferida automaticamente.
9. Estado real divergente da documentação bloqueia apenas a operação afetada:
   primeiro corrigir o diagnóstico, sem reiniciar o projeto.
10. Segredos, tokens, dados pessoais e valores de credenciais nunca entram no Git,
    em logs versionados ou no handoff.

## Papéis

| Papel                | Responsabilidade                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Usuário responsável  | Define prioridade, aprova mudanças de ambiente, homologação, merge, migration e promoção para Production              |
| Coordenador          | Mantém objetivo, escopo, gate e autorização explícitos; não apresenta execução de outro agente como evidência própria |
| Executor             | Confirma estado, trabalha somente no gate autorizado, produz testes e registra exatamente o que executou              |
| Revisor independente | Revisa o HEAD exato e reporta achados; não corrige nem aprova outro SHA por inferência                                |
| CI                   | Reproduz verificações locais sem credenciais remotas; não concede autorização operacional                             |

ChatGPT, Codex e Claude podem exercer coordenação, execução ou revisão. O papel da
sessão é definido pela autorização recebida, não pelo nome da ferramenta.

## Estados de entrega

Uma funcionalidade deve usar apenas estes estados:

| Estado                  | Significado                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| Implementada            | Existe numa branch/commit identificados                            |
| Validada localmente     | Testes declarados foram executados no ambiente local identificado  |
| CI aprovada             | Checks obrigatórios passaram no mesmo HEAD                         |
| Disponível em Preview   | Artefato do HEAD está implantado em Preview                        |
| Schema em HML           | Migrations identificadas estão aplicadas no projeto de homologação |
| Homologada              | Fluxos reais aprovados no Preview/HML e vinculados ao HEAD/schema  |
| Integrada               | Código foi mergeado em `main`                                      |
| Publicada em Production | Artefato foi promovido ao domínio de Production                    |
| Ativada                 | Flag ou configuração comercial foi deliberadamente habilitada      |

Não usar “pronto”, “publicado” ou “homologado” sem indicar qual estado acima foi
comprovado.

## Gate 0 — início e retomada

### Entrada

- objetivo e escopo definidos;
- autorização vigente explícita;
- repositório e checkout conhecidos.

### Ações

1. Ler `AGENTS.md` e/ou `CLAUDE.md`.
2. Ler `PROGRESS.md`, `docs/ESTADO_DO_PROJETO.md`, `docs/HANDOFF.md` e, quando
   houver ambiente remoto no escopo, `docs/AMBIENTES.md`.
3. Confirmar remote, branch, HEAD, upstream, working tree, worktrees e PRs,
   conforme a [reconciliação na retomada](#reconciliação-na-retomada).
4. Identificar a tarefa ativa, o gate em andamento e o ambiente-alvo.
5. Comparar fatos mutáveis baratos de verificar com GitHub e o ambiente autorizado.
6. Preservar trabalho local de terceiros e continuar do último checkpoint válido.

### Saída

- base e escopo confirmados;
- próxima ação e proibições conhecidas;
- divergências materiais resolvidas ou registradas como bloqueio.

## Transferência entre agentes

Codex CLI, Claude Code e outras sessões compartilham **um único checkpoint**:
`docs/HANDOFF.md` no worktree da tarefa ativa. Memória própria da ferramenta,
histórico de conversa e relatórios no chat não são fonte de estado; o Git e o
GitHub prevalecem sobre qualquer um deles. Não é preciso commitar a cada comando,
apenas registrar o checkpoint antes de transferir.

### Checkpoint por tarefa e antes de transferir

Ao concluir ou interromper **cada tarefa**, inclusive documental, o executor
atualiza a seção “Última tarefa” do HANDOFF com tarefa executada, resultados e
testes comprovados, código/PR afetados, ambientes envolvidos, pendências e decisões,
próxima ação exata e autorizações/proibições. Resultado não executado é “não
executado”; resultado antigo identifica SHA e data e não se transfere à tarefa.
O validador exige esses sete campos. A CI compara o conjunto publicado desde o
HEAD anterior do evento (ou a base do PR na abertura) e recusa alterações sem
HANDOFF no mesmo conjunto. A checagem estrutural não confirma a veracidade do
relato; a evidência continua sendo responsabilidade do executor.

Quando commit e push estiverem autorizados, o checkpoint acompanha a tarefa na
branch ativa. Sem autorização de publicação, atualizar somente o working tree e
declarar que o GitHub ainda não recebeu a tarefa. Nenhuma ferramenta tem exceção:
as mesmas regras se aplicam a Claude Code, Codex e outras IAs.

O [mecanismo pós-Preview](continuidade/CHECKPOINT_AUTOMATICO.md) altera somente um
bloco técnico delimitado do HANDOFF e acrescenta um recibo por deployment, com
escrita atômica condicionada ao HEAD. Não substitui o checkpoint funcional do agente
nem infere homologação, destino do banco, migrations ou decisões comerciais.

O agente que encerra ou pausa a sessão atualiza no HANDOFF:

1. worktree (caminho absoluto) e branch;
2. `HEAD validado`: SHA completo, informando se local e remoto coincidem;
3. alterações não commitadas, por caminho, ou “Nenhuma”;
4. último gate concluído e gate em andamento;
5. testes executados, cada um vinculado ao SHA ou ao working tree em que rodou;
6. próxima ação autorizada, proibições e bloqueios;
7. o que foi executado, o que funcionou e o que não funcionou, com a evidência e o ambiente de cada resultado;
8. o estado de cada entrega nos níveis **implementado, validado localmente, CI aprovada, publicado em Preview,
   aplicado no HML, homologado e publicado em Production**, que nunca são equivalentes (código no Preview não é
   migration aplicada; CI verde não é homologação).

Commit e push do checkpoint seguem a autorização vigente. Sem ela, o HANDOFF fica
atualizado no working tree e aparece em “Alterações não commitadas”. Um checkpoint
não pode registrar como concluído check que não rodou no SHA declarado.

O commit que grava o checkpoint muda o HEAD. Por isso o HANDOFF registra o último
SHA **validado**, e commits posteriores que alterem somente `docs/HANDOFF.md` não
invalidam suas evidências. Qualquer outra diferença invalida.

### Reconciliação na retomada

1. Descobrir o checkout com `git rev-parse --show-toplevel`, `git worktree list` e
   `git branch --show-current`; conferir `git status --short --branch`. Caminhos
   escritos no checkpoint são evidência da sessão anterior, não configuração fixa.
2. HEAD local com `git rev-parse HEAD`; HEAD remoto com
   `git ls-remote origin refs/heads/<branch>` ou `gh pr view <n> --json headRefOid`.
   O clone pode buscar só `main`: não confiar em `origin/<branch>` sem conferir.
3. `git diff --stat <HEAD validado> HEAD`: se tocar algo além do HANDOFF, as
   evidências registradas não valem para o HEAD atual.
4. Alteração não commitada ausente do HANDOFF pertence a outro agente ou pessoa:
   preservar, não commitar nem descartar, e reportar se afetar a tarefa.
5. Conferir checks pelo SHA (`gh pr checks <n>` ou check-runs do commit), nunca
   pela última execução visível.
6. Divergência entre HANDOFF e Git/GitHub é registrada no próprio HANDOFF antes
   de qualquer ação da tarefa.
7. Quando houver atualização remota autorizada, buscar a branch descoberta e
   sincronizar exclusivamente por fast-forward se o working tree estiver limpo.
   Havendo alteração local, commit local exclusivo ou divergência, preservar e
   reportar; não usar stash, reset, rebase ou descarte automático.

## Gate 1 — desenvolvimento

### Entrada

- Gate 0 concluído;
- branch/worktree isolados;
- requisitos e contratos reais inspecionados.

### Ações

- criar teste RED antes de alterar comportamento executável;
- implementar o mínimo para GREEN e refatorar sem ampliar escopo;
- usar fixtures sintéticas;
- criar migration nova para mudança de banco, nunca editar migration já aplicada;
- preservar compatibilidade de deploy conforme o risco da tarefa;
- não acessar ambiente remoto apenas para fazer teste local passar.

### Saída

- diff restrito ao escopo;
- testes direcionados verdes;
- nenhuma alteração involuntária de migration, segredo ou configuração.

## Gate 2 — validação local e CI

### Entrada

- implementação concluída na branch;
- ambiente local destrutivo, quando necessário, comprovadamente isolado.

### Evidências mínimas

- testes direcionados e regressões exigidas pelo projeto;
- todos os scripts `test:*` quando a tarefa alcançar código da aplicação;
- lint, TypeScript, Prettier dos arquivos alterados, build e `git diff --check`;
- SQL local real quando houver banco, sem substituir falha de infraestrutura por PASS;
- catálogo, paridade, segurança, compatibilidade e rollback quando aplicáveis;
- CI no HEAD exato.

### Saída

- PR Draft com evidências e limitações;
- check verde no mesmo HEAD ou falha registrada;
- nenhuma alegação de homologação.

## Gate 3 — Preview

### Entrada

- Gate 2 aprovado;
- deploy Preview vinculado ao HEAD candidato;
- destino Supabase de teste/homologação comprovado, nunca Production.

### Ações

- registrar URL protegida, deployment ID, commit e projeto Supabase de destino;
- conferir que variáveis pertencem ao escopo Preview sem revelar valores;
- manter a funcionalidade indisponível quando o schema exigido ainda não existir;
- não executar migration automaticamente pelo aplicativo ou pela abertura do PR.

### Saída

- frontend candidato acessível no ambiente correto;
- vínculo Preview ↔ Supabase comprovado;
- migration head anterior registrado.

## Gate 4 — preparação de HML

### Entrada

- autorização específica de alteração em HML;
- backup e capacidade de recuperação avaliados;
- sequência real de migrations e runbooks revisados.

### Ações

1. Confirmar novamente o project ref e o migration head.
2. Fazer `dry-run` quando suportado e revisar o delta.
3. Aplicar somente as migrations autorizadas, na ordem.
4. Verificar histórico, catálogo, owners, grants, RLS, funções e dados preservados.
5. Registrar migrations aplicadas e o que permaneceu desligado.

### Saída

- schema de homologação compatível com o candidato;
- recuperação e limitações documentadas;
- nenhum efeito em Production.

## Gate 5 — homologação

### Entrada

- Preview e HML vinculados e compatíveis;
- dados e identidades de teste autorizados;
- plano de casos reais definido.

### Ações

- executar fluxos reais no navegador, inclusive falhas e permissões;
- validar Auth, papéis, MFA, RLS e isolamento de cliente;
- conferir valores financeiros, idempotência, fatura, histórico e auditoria quando
  o escopo for financeiro;
- registrar executor, data, HEAD, deployment e migration head;
- separar E2E real de testes simulados.

### Saída

- resultados e riscos apresentados ao usuário;
- aprovação explícita de homologação registrada;
- qualquer falha retorna ao Gate 1 sem promover o candidato.

## Gate 6 — integração

### Entrada

- homologação aprovada;
- revisão independente no HEAD exato;
- checks obrigatórios verdes e threads resolvidas;
- autorização explícita de merge.

### Ações

- atualizar branch se necessário e repetir checks afetados;
- merge conforme o método autorizado;
- registrar merge SHA;
- **não** interpretar o merge como autorização de Production.

### Saída

- código integrado em `main`;
- build de Production, se automático, permanece staged/não promovido até o gate
  seguinte. Enquanto a Vercel publicar `main` automaticamente, esse comportamento
  é risco bloqueante e exige contenção administrativa fora do repositório.

## Gate 7 — Production

### Entrada

- autorização específica para Production;
- backup novo e recuperação verificados;
- migration head, artefato e plano de rollback confirmados;
- build staged associado ao merge SHA.

### Ordem obrigatória

1. Confirmar domínio, projeto Supabase e variáveis por escopo sem revelar valores.
2. Produzir e verificar o backup exigido.
3. Aplicar migrations autorizadas em Production, na ordem comprovada.
4. Executar verificações de banco não destrutivas.
5. Promover deliberadamente o build staged ao domínio de Production.
6. Executar smoke tests e observar logs na janela autorizada.
7. Ativar flags ou regras comerciais somente por autorização separada.

### Saída

- artefato e banco compatíveis em Production;
- resultado pós-publicação registrado;
- rollback disponível ou risco residual explicitamente aceito.

## Gate 8 — encerramento

### Ações

- atualizar `ESTADO_DO_PROJETO.md` com fatos e evidências por ambiente;
- atualizar `PROGRESS.md` com a próxima tarefa única;
- substituir o checkpoint operacional em `HANDOFF.md`;
- encerrar ou pausar a tarefa com motivo objetivo;
- somente então liberar a próxima tarefa da fila.

## Incidente e rollback

1. Interromper novas promoções e identificar ambiente, SHA e migration head.
2. Preservar logs e dados; não “corrigir” apagando histórico.
3. Preferir rollback do aplicativo para artefato compatível.
4. Reverter banco somente com runbook específico, guardas de histórico e
   autorização. Havendo uso incompatível, fazer forward-fix.
5. Validar integridade após a recuperação e registrar o incidente no estado do
   projeto.

Falha em Preview/HML não autoriza teste equivalente em Production. Falha de
infraestrutura não é falha de negócio nem PASS.

## Evidência mínima por entrega

- repositório, branch, base e HEAD;
- PR e estado Draft/Ready/merge;
- ambiente-alvo e ambientes não tocados;
- deployment ID/URL quando aplicável;
- project ref e migration head quando aplicável;
- comandos executados, resultado e contagem de falhas;
- aprovação do usuário e escopo exato;
- riscos, rollback e próxima ação.

O template de PR e o validador documental reforçam esses campos, mas não
substituem revisão humana nem controles administrativos do GitHub, Vercel e
Supabase.
