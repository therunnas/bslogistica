# Runbooks — escopo, versões e recuperação

SDLC: Manutenção / Recuperação. Este índice descreve procedimentos versionados,
não o estado de um ambiente nem uma autorização de execução. O estado factual
fica em [Estado do projeto](../ESTADO_DO_PROJETO.md); a política de acesso vigente,
em [Segurança](../SEGURANCA.md). Os SQL históricos permanecem preservados.

## Condições comuns antes de qualquer execução

- Obter autorização específica para o ambiente, a operação e a janela. Uma
  autorização de leitura ou de teste local não autoriza recuperação remota.
- Identificar o SHA do aplicativo, o catálogo efetivo, as migrations e seus
  dependentes. A versão de origem abaixo é o estágio histórico de referência;
  não basta encontrar esse número em `schema_migrations`. Um SQL de reversão não
  deve ser presumido capaz de atualizar esse registro ou desfazer versões seguintes.
- Conferir as funções, assinaturas, permissões, triggers, dados e auditoria que
  serão afetados. Reproduzir o estado em ambiente descartável isolado antes de
  avaliar o ambiente autorizado. O postgres local superusuário não comprova os
  privilégios do Supabase hospedado.
- Ter backup e recuperação compatíveis com o alvo, com integridade e restauração
  verificadas. Um dump existente ou um ensaio antigo não prova recuperação atual.
- Definir compatibilidade e ordem de reversão do aplicativo e do banco. Os
  procedimentos MFA históricos pedem aplicativo anterior primeiro; isso não
  substitui a análise dos consumidores financeiros de cada versão.
- Conferir todas as recusas do SQL. Ausência de uma trava de versão posterior não
  significa compatibilidade. Não remover guardas para permitir a execução, apagar
  histórico, usar CASCADE indiscriminado ou reprecificar faturados.
- Depois de uma execução autorizada, comparar catálogo, dados, valores, snapshots,
  lastro e auditoria; registrar evidência e limites no checkpoint apropriado.

## Risco especial: rollback da 034

**Não aplicar diretamente `rollback-mfa-somente-login.sql` sobre schemas
financeiros posteriores.** Seu destino histórico é o estado 032+033: além da
política de acesso, restaura `gerar_fatura` com o corpo anterior da 030. Não há
pré-checagem de todas as migrations posteriores nesse arquivo.

A 037 muda os leitores para componentes; a 038 acrescenta validação de período e
competência ao faturamento. Restaurar o corpo antigo sobre esses schemas pode
retirar essas regras sem remover suas estruturas. Os dados existentes não serem
apagados pelo script não prova integridade dos faturamentos futuros.

A recuperação exige analisar e desfazer os dependentes posteriores quando isso
for comprovadamente seguro, ou preparar procedimento específico para o catálogo
real. Não basta reverter o app e executar o SQL da 034. A mesma cautela vale para
SQL que restauram corpos antigos de derivação ou de anúncio de capacidades.

## Matriz dos SQL históricos

Origem e destino descrevem o catálogo funcional esperado, incluindo a revisão
aplicável da migration; não certificam nenhum banco remoto. Os bloqueios abaixo
são um resumo: o SQL completo e seus dependentes devem ser conferidos.

| Arquivo                                                                        | Origem de referência → destino                          | Dependências, condições e riscos                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [recuperacao-c02-020.sql](recuperacao-c02-020.sql)                             | Estado exato da 020 → funções/policies anteriores à 020 | Exige hashes, contagens e dependentes previstos pelo script; reabre a C02. Seguir o [procedimento de recuperação](recuperacao-c02-020.md), não usar como rollback genérico.                            |
| [rollback-mfa-opcional.sql](rollback-mfa-opcional.sql)                         | 032 → política anterior à 032                           | App anterior primeiro; volta a exigir MFA. Corpos históricos e remoção de helpers exigem análise de 033, 034 e demais dependentes antes.                                                               |
| [rollback-taxa-legada-vigencia.sql](rollback-taxa-legada-vigencia.sql)         | 033 → estado anterior à 033 (032 no estágio original)   | Retira triggers/helper que exigem vigência no INSERT de taxas legadas. Reabre essa porta de integridade; não é reversão de MFA. Compatibilidade com versões seguintes precisa ser demonstrada.         |
| [rollback-mfa-somente-login.sql](rollback-mfa-somente-login.sql)               | 034 → 032+033                                           | App anterior primeiro; AAL2 literal volta às operações críticas. Restaura faturamento antigo; risco de regressão em schemas posteriores, conforme aviso acima.                                         |
| [rollback-nucleo-financeiro.sql](rollback-nucleo-financeiro.sql)               | 035 → ausência das seis funções do núcleo (estágio 034) | Primeiro desfazer integração e consumidores posteriores; verifica funções e triggers dependentes. Não recupera dados, pois a 035 só cria funções puras.                                                |
| [rollback-integracao-nucleo-v2.sql](rollback-integracao-nucleo-v2.sql)         | 036 → integração anterior à 036, preservando 035        | Recusa presenças/reposições V2 e adicional; neutraliza componentes de faltas conforme o script. Desfazer consumidores posteriores antes de restaurar os corpos antigos.                                |
| [rollback-leitores-por-componentes.sql](rollback-leitores-por-componentes.sql) | 037 → leitores anteriores à 037, preservando 035/036    | Recusa itens novos de fatura; restaura leitores históricos e ajuste acumulado. Não reconstitui faturamento emitido nem substitui análise de versões posteriores.                                       |
| [rollback-periodo-contratual.sql](rollback-periodo-contratual.sql)             | 038 → estágio 037                                       | Recusa frequência diferente de quinzenal e competência de cobrança em adicional. Restaura assinaturas, grants e corpos anteriores; conferir app e dependentes posteriores.                             |
| [rollback-funcoes-turno.sql](rollback-funcoes-turno.sql)                       | 039 → estágio 038                                       | Recusa classificação de turno/alocação, função escolhida e catálogo alterado nos casos previstos. Vínculo automático derivável pode ser removido; desfazer consumidores posteriores antes.             |
| [rollback-snapshots-funcao-periodo.sql](rollback-snapshots-funcao-periodo.sql) | 040 → estágio 039                                       | Recusa snapshots de função/período ou correção auditada. Não apagar snapshots para vencer a guarda.                                                                                                    |
| [rollback-tarifas-por-funcao.sql](rollback-tarifas-por-funcao.sql)             | 041 → estágio 040                                       | Recusa tarifas, vínculos, resolução ligada ou auditoria. Remove a configuração de resolução apenas no estágio sem uso previsto pelo SQL.                                                               |
| [rollback-diaria-individual-bonus.sql](rollback-diaria-individual-bonus.sql)   | 042 → estágio 041                                       | Recusa diária individual, vínculo, bônus ou auditoria. Preservar os dados; analisar dependentes posteriores antes de restaurar funções da 041.                                                         |
| [rollback-dias-especiais-v2.sql](rollback-dias-especiais-v2.sql)               | 043 → estágio 042                                       | Recusa uso/configuração especial incompatível, inclusive auditada. Restaura derivação e capacidades da 042; não verifica toda versão futura. Não executar diretamente se outro schema depender da 043. |

A ordem nominal inversa (043 → 042 → … → 035) é apenas uma relação de
precedência dos estágios financeiros. **Não é uma sequência de comandos pronta
para execução:** qualquer utilização incompatível pode impedir uma das reversões.
Versões posteriores, inclusive as ainda em revisão, exigem reavaliar o plano.
Nenhum procedimento deste índice presume que FIN-PR-10 esteja integrado.

## Procedimentos Markdown e evidências preservadas

- [Recuperação C02/020](recuperacao-c02-020.md): procedimento emergencial com
  integridade do arquivo SQL, pré-condições e limitações de Auth, event triggers,
  privilégios hospedados e cobertura do backup. As observações de ambiente nele
  registradas são históricas; não comprovam o estado atual.
- [Reversão do motor](reversao-do-motor.md): desliga o motor pela RPC existente,
  mantendo o schema. Não equivale a remover migrations. Exige autorização,
  sessão administrativa válida, piso de MFA, motivo e controles descritos.
- [Production 034 → 050](producao-034-050.md): plano de implantação das 16
  migrations e da publicação do site, com o script
  [aplicar-migration-api.py](aplicar-migration-api.py) (uma migration por vez,
  conferência antes e depois, só conferência por padrão). Exige autorização nominal.
- [Domingo e feriado em dobro (051)](dias-especiais-em-dobro.md): aplicar a 051 e
  ligar o interruptor `dias_especiais_em_dobro`, primeiro no HML e depois em Production,
  com as pré-condições (feriados e custo vigente) e a reversão. Exige autorização nominal.

Os requisitos de backup, ensaio, catálogo e autorização são condições de uso,
não declarações de que HML ou Production os satisfazem. Atualizações executáveis
nos SQL, novos ensaios ou execução em ambientes exigem escopo próprio.
