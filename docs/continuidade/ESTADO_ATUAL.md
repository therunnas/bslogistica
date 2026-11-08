# Estado atual — ponto de entrada

A fonte principal e única do **estado atual** é o [HANDOFF](../HANDOFF.md).
Ele contém etapa/estado funcional, Git/PR/alterações locais, ambientes e migrations,
cobertura, decisões, defeitos, bloqueios e próxima ação exata.

- [Livro dos 484 controles](controles-sessao-19.json): fonte dos resultados por ID;
  recalcular contagens a partir dele. Toda mudança de status exige evidência própria.
- [Matriz S19](../homologacao-sessao-19.md): evidências e históricos datados.
- [Estado do projeto](../ESTADO_DO_PROJETO.md): histórico das decisões e implantações.
- [Ambientes](../AMBIENTES.md): inventário datado; conferir o limite da verificação.
- [Workflow](../WORKFLOW.md) e [protocolo](PROTOCOLO_DE_TRABALHO.md): regras permanentes.
- [Checkpoint automático](CHECKPOINT_AUTOMATICO.md): contrato por tarefa, evidências
  técnicas de Preview e requisitos de ativação; estado ativo continua no HANDOFF.
- [Roteiro de homologação manual](../homologacao-release-preview-01.md): itens por fluxo, com os que dependem de migrations ainda não aplicadas.

**Regra de continuidade.** Toda tarefa, ao concluir ou pausar, atualiza o HANDOFF com o que foi executado, o que
funcionou, o que não funcionou, as evidências e ambientes, as pendências, a próxima ação e o que não está autorizado.
O HANDOFF distingue sempre implementado, validado localmente, CI aprovada, publicado em Preview, aplicado no HML,
homologado e publicado em Production: estados distintos, nunca equivalentes. Sem push autorizado, o checkpoint fica
só no worktree e a diferença é informada.

No conflito entre um relato histórico e o checkpoint, retomar pelo HANDOFF e
reconciliar com Git/GitHub e o ambiente autorizado. Não copiar estado mutável para
este índice. Arquivo local, inclusive em `/private/tmp`, não está automaticamente
publicado no GitHub nem disponível para outra IA.
