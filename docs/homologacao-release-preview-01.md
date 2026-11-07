# Roteiro de homologação manual — RELEASE-PREVIEW-01

Preview único da branch `integracao/release-preview-01` (`main` + #108/#109/#110 + #106), apontado para o
HML `qbnfcmrxmssnwkhaitgd` (schema **045**). Estado e evidências: [HANDOFF](HANDOFF.md).
Resultados anteriores por controle: [livro da sessão 19](continuidade/controles-sessao-19.json).

## 0. Antes de começar

- Abrir **somente** a URL do Preview informada no HANDOFF (domínio `*.vercel.app` com login da Vercel).
  Nunca `admin.bslogisticas.com.br` (Production).
- Usar a conta **admin** própria. Para o papel **operacional**, usar uma conta sintética do HML; se não houver,
  marcar os itens de operacional como BLOQUEADO (não criar usuário operacional real).
- Todo cadastro novo começa com o prefixo `HML-TESTE` (ex.: `HML-TESTE Cliente Manual 01`).
- Registrar cada item como **PASS**, **FAIL** (com print e passo exato) ou **BLOQUEADO** (com motivo).

**Limites conhecidos deste Preview (não são defeitos):**

- Convidar usuário, trocar papel e recuperação de senha dependem de variáveis que o Preview genérico não tem:
  devem mostrar indisponibilidade, sem quebrar a tela.
- O HML está na **045**. A 046 (imutabilidade de fatura com adicionais) e a 047 (idempotência de adicionais)
  **não** estão aplicadas: os itens 9.4 e 12.5 só são homologáveis depois delas.

## 1. Login, sessão e MFA

| #   | Ação                                                  | Resultado esperado                                             |
| --- | ----------------------------------------------------- | -------------------------------------------------------------- |
| 1.1 | Entrar com e-mail e senha corretos                    | Painel abre (ou pede TOTP se a conta tem MFA)                  |
| 1.2 | Senha errada                                          | Mensagem de erro; sem entrar                                   |
| 1.3 | Conta com MFA: código TOTP errado, depois o certo     | Errado recusado; certo libera o painel                         |
| 1.4 | Sair e tentar abrir `/dashboard` pela URL             | Volta para o login                                             |
| 1.5 | Configurações → MFA (opcional): ver o estado do fator | Estado coerente com a conta; nenhum código pedido por operação |

## 2. Papéis e isolamento

| #   | Ação                                                      | Resultado esperado                                                    |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| 2.1 | Admin: percorrer o menu                                   | Todos os módulos administrativos visíveis                             |
| 2.2 | Operacional: entrar                                       | Só a área `/operacional`, com as operações atribuídas                 |
| 2.3 | Operacional: abrir `/faturamento` ou `/clientes` pela URL | Acesso negado/redirecionado                                           |
| 2.4 | Operacional: DevTools → Rede, ao listar apontamentos      | Nenhum valor financeiro (diária, custo, valor faturado) nas respostas |

## 3. Dashboard

| #   | Ação                                         | Resultado esperado                                                  |
| --- | -------------------------------------------- | ------------------------------------------------------------------- |
| 3.1 | Abrir o Dashboard                            | Carrega sem erro; valores em R$ (BRL) nos gráficos e rótulos (#106) |
| 3.2 | Comparar a receita do período com Relatórios | Mesmo valor                                                         |

## 4. Clientes e contratos

| #   | Ação                                               | Resultado esperado                              |
| --- | -------------------------------------------------- | ----------------------------------------------- |
| 4.1 | Criar cliente `HML-TESTE …` com dados válidos      | Salvo e listado                                 |
| 4.2 | Criar cliente com campo obrigatório vazio/inválido | Mensagem clara; nada salvo (#106)               |
| 4.3 | Criar contrato com jornada de **0 horas**          | Recusado, sem valor assumido em silêncio (#106) |
| 4.4 | Criar contrato válido (diária, HE, período)        | Salvo; período contratual coerente              |
| 4.5 | Ação irreversível (ex.: encerrar vigência)         | Pede confirmação explícita antes (#106)         |

## 5. Colaboradores

| #   | Ação                                        | Resultado esperado                                        |
| --- | ------------------------------------------- | --------------------------------------------------------- |
| 5.1 | Criar colaborador com função e custo diário | Salvo; vigência de custo registrada                       |
| 5.2 | Corrigir o custo com nova vigência          | Histórico preservado; datas exibidas no fuso local (#106) |

## 6. Operações e turnos

| #   | Ação                                         | Resultado esperado                          |
| --- | -------------------------------------------- | ------------------------------------------- |
| 6.1 | Criar operação ligada ao contrato e um turno | Salvos                                      |
| 6.2 | Criar operação **avulsa**                    | Fluxo aceito conforme regra aprovada (#106) |
| 6.3 | Montar equipe (colaborador + função)         | Equipe listada                              |

## 7. Apontamentos, diárias e horas extras

| #   | Ação                                                        | Resultado esperado                                                                                   |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 7.1 | Lançar presença com entrada/saída dentro da jornada         | Diária = valor do contrato; sem HE                                                                   |
| 7.2 | Lançar presença com 1 h além da jornada                     | HE conforme diária, jornada, fator e tolerância do contrato; igual ao valor mostrado antes de salvar |
| 7.3 | Lançar falta                                                | Não conta diária                                                                                     |
| 7.4 | Valor mostrado antes de salvar                              | Igual ao valor gravado depois (o banco decide)                                                       |
| 7.5 | Operacional: lançar o próprio apontamento (se houver conta) | Aceito; sem valores financeiros na tela                                                              |

## 8. Containers

| #   | Ação                                                                  | Resultado esperado                             |
| --- | --------------------------------------------------------------------- | ---------------------------------------------- |
| 8.1 | Registrar serviço de container                                        | Salvo; datas corretas (#106)                   |
| 8.2 | Conferir o custo no Fechamento/Faturamento do período **de cobrança** | Custo entra na competência do adicional (#106) |

## 9. Adicionais

| #   | Ação                                                                     | Resultado esperado                                                    |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 9.1 | Registrar adicional com motivo                                           | Salvo uma vez; listado                                                |
| 9.2 | Clique duplo rápido em "Registrar"                                       | Um único adicional                                                    |
| 9.3 | Registrar, fechar o diálogo, reabrir e conferir a lista                  | Nenhuma duplicata                                                     |
| 9.4 | (Só após a 047 no HML) Rede cai depois de enviar; reabrir e reenviar     | Reconcilia pela chave, sem duplicar                                   |
| 9.5 | No HML 045, se aparecer "Envio anterior sem confirmação no banco legado" | Comportamento esperado de bloqueio: conferir a lista antes de repetir |

## 10. Fechamento

| #    | Ação                          | Resultado esperado                                      |
| ---- | ----------------------------- | ------------------------------------------------------- |
| 10.1 | Abrir o Fechamento do período | Faturado = soma de diária + HE + especiais + adicionais |
| 10.2 | Baixar CSV e XLSX             | Arquivos abrem; totais iguais à tela                    |
| 10.3 | Baixar XLSX do cliente        | Total do cliente sem custo, margem ou resultado         |

## 11. Relatórios

| #    | Ação                       | Resultado esperado                                    |
| ---- | -------------------------- | ----------------------------------------------------- |
| 11.1 | Gerar relatório do período | Totais iguais ao Fechamento                           |
| 11.2 | Exportar CSV               | Separadores e acentos corretos; valores em BRL (#106) |

## 12. Faturamento e faturas emitidas

| #    | Ação                                            | Resultado esperado                                          |
| ---- | ----------------------------------------------- | ----------------------------------------------------------- |
| 12.1 | Prévia do faturamento                           | Margem inclui custo de Containers                           |
| 12.2 | Gerar fatura do período                         | Fatura emitida; itens = lançamentos e adicionais do período |
| 12.3 | Tentar gerar de novo a mesma fatura             | Recusado (sem duplicar)                                     |
| 12.4 | Editar apontamento ou adicional já faturado     | Recusado                                                    |
| 12.5 | (Só após a 046 no HML) Fatura só com adicionais | Imutável                                                    |

## 13. Erros e robustez

| #    | Ação                                             | Resultado esperado                                |
| ---- | ------------------------------------------------ | ------------------------------------------------- |
| 13.1 | Salvar com a rede desligada (DevTools → Offline) | Mensagem de erro clara; nada duplicado ao religar |
| 13.2 | Recarregar no meio de uma edição                 | Nada salvo pela metade                            |
| 13.3 | Abrir rota inexistente                           | Página de erro/redirect, sem dados expostos       |

## 14. Usuários e configurações (admin)

| #    | Ação                                | Resultado esperado                            |
| ---- | ----------------------------------- | --------------------------------------------- |
| 14.1 | Listar usuários                     | Datas/horários corretos (#106)                |
| 14.2 | Convidar usuário ou trocar papel    | Indisponível neste Preview (limite conhecido) |
| 14.3 | Configurações → ativação por código | Fluxo conforme regra aprovada (#106)          |

## Critério para liberar Production

Todos os itens aplicáveis PASS, nenhum FAIL aberto, BLOQUEADOS justificados, e 046/047 aplicadas e homologadas
no HML (itens 9.4 e 12.5) — cada passo com autorização própria.
