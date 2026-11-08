# Protocolo de trabalho entre agentes

SDLC e gates: [Workflow](../WORKFLOW.md). Estado atual: [HANDOFF](../HANDOFF.md).

1. ChatGPT prepara o prompt.
2. O usuário envia ao Claude Code ou Codex.
3. O agente executa o escopo autorizado e apresenta relatório verificável.
4. O usuário retorna o relatório ao ChatGPT.
5. ChatGPT revisa, decide e prepara a próxima etapa.

Cabeçalho obrigatório, **fora do bloco de código**: `MODELO`, `EFFORT`, `ETAPA`,
`SESSÃO`; `ESTILO` e `SKILL` quando aplicáveis. Em seguida, um único bloco copiável
com todo o prompt de execução. Modelo em [Padrão de prompts](../PADRAO_DE_PROMPTS.md).

Antes de encerrar cada sessão, atualizar o HANDOFF com os sete grupos: estado
funcional/etapa; Git/PR/alterações locais; ambientes/migrations; cobertura/evidências;
decisões; defeitos/riscos/bloqueios; próxima ação exata. Preservar históricos datados.

Além da troca de sessão, concluir ou interromper **cada tarefa** exige preencher
os sete campos da seção “Última tarefa”. Com publicação autorizada, o HANDOFF
acompanha os commits e o push da tarefa na branch ativa; sem autorização permanece
local. O [checkpoint automático](CHECKPOINT_AUTOMATICO.md) acrescenta somente
evidências técnicas de CI/Preview e não executa homologação funcional.

O relatório diferencia arquivos locais, commits locais e arquivos publicados,
indicando branch, SHA remoto e CI no SHA exato. Não presumir que outra IA acessa
um caminho local ou que um arquivo já está no GitHub. Evidência necessária à
retomada deve ser sanitizada e versionada quando autorizado; artefatos brutos locais
são identificados como locais, com limites e hashes quando disponíveis.

Não registrar segredos, credenciais ou informações privadas de contas/provedores.
Documentação não concede autorização para outro ambiente ou gate.
