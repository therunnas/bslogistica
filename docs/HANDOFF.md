# Handoff ativo

<!-- workflow-handoff:v1 -->

**Fonte principal do estado atual. UX-SIMPLIFICACAO-02, 07/11/2026. UX-01 commitada e publicada no PR #111.**
SDLC: Desenvolvimento / Testes. Objetivo: simplificar as telas administrativas sem mudar regra financeira,
histórico, auditoria ou segurança, antes de um novo Preview no PR #111.

## Identificação

| Campo                     | Valor                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Etapa                     | UX-SIMPLIFICACAO-02 — publicação da UX-SIMPLIFICACAO-01 no Preview do PR #111                                                |
| Gate atual                | Gate 3 (Preview) em conferência; homologação manual da nova UX pendente                                                      |
| Último gate concluído     | RELEASE-PREVIEW-02: push da integração, PR Draft #111, CI verde e Preview com destino HML provado                            |
| Worktree                  | `/private/tmp/bs-fin-20d`                                                                                                    |
| Branch                    | `integracao/release-preview-01` (publicada; PR Draft #111 contra `main`)                                                     |
| Base                      | `main` `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`                                                                            |
| HEAD validado             | `4648e2b6a6adea83448a3891af72b469b6d3fe41` (#111, CI verde); a UX-SIMPLIFICACAO-01 está por cima, sem commit                 |
| Alterações não commitadas | nenhuma: a UX-SIMPLIFICACAO-01 está no commit `feat(ux): simplify administrative workflows`, filho de `4648e2b`              |
| PR                        | #111 Draft, atualizado com o commit da UX; #106, #108, #109 e #110 em Draft, inalterados                                     |
| Ambiente-alvo             | Preview do #111 × HML `qbnfcmrxmssnwkhaitgd` (somente leitura nesta etapa)                                                   |
| Última ação comprovada    | Validação local completa: lint, `tsc`, Prettier, 82/82 suítes Node e build; evidência visual em app local contra stack local |
| Próxima ação exata        | Conferir CI e Preview pelo SHA do commit da UX; executar os itens 5, 6, 8 e 12 do roteiro manual                             |

## Evidências

- Preview anterior (RELEASE-PREVIEW-02): `dpl_neQcXPsZ8UiyL3qNyMbRjfwoDf8y`, SHA `4648e2b`, destino HML provado.
- UX-SIMPLIFICACAO-01 (07/11/2026), só apresentação, sem migration, RLS, grant, trigger ou RPC novos:
  - Colaboradores: custo editado no próprio cadastro vira **nova vigência** pela RPC existente
    `registrar_custo_colaborador` (data ≥ hoje, motivo, confirmação explícita); recusa data passada, mesma data e
    custo futuro já programado; lista, custo médio e "Atual" mostram o custo **vigente** (antes mostravam
    `employees.daily_cost`, que não acompanha as vigências). Histórico recolhido.
  - Contratos: tolerância e parâmetros da 030 em "Regras especiais"; histórico recolhido.
  - Operações: filtro Fixas com contrato × Avulsas por serviço; linha de cobrança explícita.
  - Containers: cada serviço abre o detalhe; valor total com quantidade, custo, resultado bruto e situação.
  - Faturamento: abas "Pendentes de faturamento" e "Faturas emitidas"; arredondamento acumulado recolhido.
- Validação local: lint, `tsc`, Prettier e build OK; **82/82** suítes Node (inclui `test:colaborador-custo` e
  `test:ux-simplificacao`, novas e na CI).
- App local (build de produção com a stack `bs-fin20d-local`, zero referência ao HML no bundle): reajuste de
  custo exercido de ponta a ponta com usuário de teste local; versão anterior encerrada em 07/11 e nova com motivo.

## Migrations por ambiente

- Repositório integrado: até a **047** (`20261114120000`). A UX-SIMPLIFICACAO-01 não acrescenta migration.
- HML `qbnfcmrxmssnwkhaitgd`: head **045** (leitura de 07/11/2026); 046 e 047 **não** aplicadas.
- Production: 034, fora do escopo. [Inventário histórico](AMBIENTES.md).

## Autorizações

UX-SIMPLIFICACAO-01: alterações locais de interface, testes, builds e documentação mínima.
UX-SIMPLIFICACAO-02: commit da UX-01, push só para `integracao/release-preview-01`, conferência de CI, deploy e
ambiente, verificações não destrutivas no Preview.

## Proibições

Sem merge, Production, PR novo, force push, migration remota (046/047 não aplicadas), gravação no HML, limpeza de
dados sintéticos, backup, alteração dos PRs de origem ou de regra financeira.

## Bloqueios e riscos

- Decisões que exigem tarefa própria (não implementadas):
  - Preço-base do contrato como recuo quando a resolução por função está ligada: hoje o banco não recua
    (sem função = pendente; função sem tarifa = P0002). Mudar exige migration e revisão de paridade.
  - Edição de serviço de container: não há RPC; o caminho seguro continua cancelar (só "disponível") e
    registrar de novo.
  - Localidade do calendário: existe só por operação (`operation_location_terms`), reutilizada por todos os
    apontamentos dela; por regra, endereço ou sede do cliente não definem localidade. Localidade por contrato
    exigiria migration. Feriados seguem na área de Contratos; validações territoriais intactas.
- Idempotência de adicionais só vale com a 047 no HML.
- Expurgo do HML, 046/047 no HML e cópia independente dos backups seguem com gates próprios.

## Retomada

1. No worktree acima, `git log -1` deve ser o commit da UX sobre `4648e2b`, com `git status` limpo.
2. Rever as decisões em "Bloqueios e riscos".
3. Conferir CI e o novo Preview pelo SHA exato; merge e Production seguem sem autorização.
