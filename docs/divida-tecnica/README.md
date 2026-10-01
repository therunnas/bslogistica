# Dívidas técnicas

Registro dos defeitos que mereceram diagnóstico próprio. Cada documento guarda a
causa e o caminho até a correção, para o caso de o sintoma reaparecer. O
comportamento atual do sistema está em [Arquitetura](../ARQUITETURA.md) e
[Segurança](../SEGURANCA.md), que vencem qualquer divergência com estes textos.

| Dívida                                                                                  | Status    | Resumo                                                                                                 |
| --------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| [Apontamento sobrescreve o horário digitado](apontamento-sobrescreve-rascunho.md)       | Resolvida | a tela regravava o horário digitado ao recalcular, perdendo receita sem aviso                          |
| [Faturamento não transacional](faturamento-nao-transacional.md)                         | Resolvida | a fatura era gerada em três escritas do navegador, deixando faturas órfãs; hoje é a RPC `gerar_fatura` |
| [Folha duplicada quando o turno é nulo](folha-duplicada-por-shift-null.md)              | Resolvida | duas folhas e duas diárias para o mesmo dia; corrigido por índices únicos (migration `008`)            |
| [Vínculo de fatura alterável por quem não é admin](rls-vinculo-de-fatura-permissivo.md) | Resolvida | o lastro de uma fatura podia ser desfeito; corrigido pelas migrations `011` e `013`                    |
| ["Registro salvo." com a RLS bloqueando](falso-sucesso-em-update-bloqueado-por-rls.md)  | Resolvida | `UPDATE` bloqueado afeta zero linhas sem erro; a interface agora confere a contagem                    |
| [Escrita permissiva em `operation_team`](escrita-em-operation-team.md)                  | Resolvida | `is_staff()` valia para qualquer papel; a migration `016` exige `admin` + `aal2`                       |

Nenhuma dívida está aberta neste diretório. Itens em aberto, quando existirem,
ficam em [Progresso](../../PROGRESS.md), na seção de riscos.
