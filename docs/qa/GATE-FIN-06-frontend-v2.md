# GATE-FIN-06 — o aplicativo nos contratos v2 da migration 054

Sessão 23 (16/11/2026, sessão em nuvem, Linux, Supabase local descartável). Branch
`fix/gate-fin-06-frontend-v2`, criada do HEAD `3dda0f17cc2c2e8ce721e8632f7dcb48490622fd` do #137
(`fix/gate-fin-05-migration-054`; sessão 22 concluída e validada nele), em PR Draft **empilhado** sobre
o #137. O #134, o #135, o #136 e o #137 não foram tocados.

**Estado: implementado e testado LOCALMENTE e na CI. Nada publicado, nada aplicado em HML ou
Production.** O banco documentado de HML e Production está na **051**: lá as RPCs v2 **não existem**, e
este app não pode ser publicado contra eles antes da 052–054 (ver "Sequência segura").

## O que mudou no aplicativo

| Fluxo                          | Antes (v1, até a sessão 22)                                                                                                                                                                                   | Agora (v2, 054)                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin grava                    | lia o `updated_at` das linhas ANTES da RPC (fora da transação) e chamava `salvar_apontamento_admin`; se a RPC não existisse (PGRST202), gravava pelo caminho anterior à 031 (INSERT de folha + upsert direto) | `salvarDiaAdminV2` chama só `salvar_apontamento_admin_v2`, com `versao_esperada` por linha; o banco confere sob trava. Sem a v2: falha controlada, nada gravado, nenhum caminho antigo                                                                                                                                           |
| Versão                         | `updated_at` (texto), conferido pela tela                                                                                                                                                                     | coluna `versao` (inteiro mantido pelo banco), lida por `select("*")`; a da linha suja é a do início da edição; nunca inventada, incrementada ou inferida                                                                                                                                                                         |
| Conflito                       | aviso genérico ("recarregue"), conferido pela tela                                                                                                                                                            | `40001` do banco → aviso específico; o rascunho fica; a linha em conflito é listada com o gravado e a alteração da pessoa, e só a decisão dela ("Manter a minha alteração" ou "Usar o que está gravado") libera o salvamento. Sem retry automático                                                                               |
| Retry / resposta perdida       | podia reenviar sobre leitura velha                                                                                                                                                                            | a linha suja igual ao banco é reconciliada; o reenvio idêntico volta `sem_alteracao` (sem versão nova, sem linha nova) e a tela diz que já estava gravado; falha de rede = "resultado incerto", rascunho mantido                                                                                                                 |
| Virada fora do turno, admin    | caixa "Confirmo…" só na tela (nada registrado)                                                                                                                                                                | a mesma caixa, agora com entrada, saída "do dia seguinte", duração interpretada e o aviso de que a confirmação é registrada no banco; vai como `confirmar_virada` na v2 e fica em `apontamento_confirmacoes_virada`. Vale para colaborador, horários, turno (jornada vigente) e versão: mudar qualquer um exige nova confirmação |
| Virada já gravada              | —                                                                                                                                                                                                             | `situacao_da_virada` mostra "Virada confirmada" ou "Virada sem confirmação"; para a pendente (ex.: gravada por app antigo), o admin registra a confirmação por `confirmar_virada_do_apontamento` na versão mostrada                                                                                                              |
| Operador lê                    | `listar_apontamentos_do_operador`                                                                                                                                                                             | `listar_apontamentos_do_operador_v2`: colunas exatas do contrato (coluna a mais é recusada pela camada) e versão em toda linha                                                                                                                                                                                                   |
| Operador grava                 | `salvar_apontamento_operacional` (seis campos)                                                                                                                                                                | `salvar_apontamento_operacional_v2` (sete: + `versao_esperada`); retorno lido (folha, versão e resultado por linha)                                                                                                                                                                                                              |
| Virada fora do turno, operador | caixa "Confirmo…" na tela dele, gravava sem registro                                                                                                                                                          | **sem confirmação**: a tela explica que só o administrador confirma, preserva o digitado e não envia; a RPC dele recusa a chave `confirmar_virada` (22023)                                                                                                                                                                       |
| Rascunho do operador           | rascunho inteiro congelado no escopo (linha não editada não acompanhava o banco)                                                                                                                              | só as linhas editadas, cada uma com a versão do início da edição; as demais acompanham a leitura                                                                                                                                                                                                                                 |

Não mudou: cálculo e valores (o banco deriva tudo; a tela não decide valor), as guardas de folha
fechada e de faturado, o que cada papel vê, RLS, grants, triggers, RPCs e migrations.

## Diagnóstico dos fluxos antigos (o que foi removido do app)

- `salvarPeloCaminhoAnterior` (INSERT em `timesheets` + `upsert` em `timesheet_entries`), usado quando a
  RPC do admin não existia: **removido** da tela.
- `salvar_apontamento_admin` (v1) e a pré-leitura de `updated_at`: **substituídos** pela v2.
- `listar_apontamentos_do_operador` e `salvar_apontamento_operacional` (v1): **substituídos** pelas v2
  na camada `src/lib/operacional/`.
- Nenhum contrato foi removido do banco: as v1 continuam lá para o app antigo (expansão da 054). A
  restrição global delas é da 058.

## Testes

### RED (no código do #137, antes das mudanças)

| Teste                                                                                 | RED                                                                                                                                          |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `test:frontend-v2` (novo, comportamento com cliente falso)                            | 41 de 43 falham; passam só os 2 controles (conflito genérico e folha vazia)                                                                  |
| `e2e/specs/82-apontamentos-v2.spec.ts` (nova) contra o app antigo e o banco com a 054 | 16 de 23 falham; passam os 7 controles do banco (preparação, turno noturno, valores v1 = v2, folha fechada/faturado e a v1 ainda disponível) |

### GREEN

| Teste                                                                 | GREEN                                                                                                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test:frontend-v2`                                                    | 43/43                                                                                                                                                                |
| spec 82                                                               | 23/23                                                                                                                                                                |
| specs 20, 30, 80 e 82 juntas (as alteradas), banco do zero            | 55/55                                                                                                                                                                |
| `test:*`                                                              | 85/85 (84 anteriores + `test:frontend-v2`)                                                                                                                           |
| Travas                                                                | 25/25                                                                                                                                                                |
| SQL do zero                                                           | 55 suítes PASS; 053 31/31; 054 61/61; 090 33 SEGURO e 13 RISCO (inalterada)                                                                                          |
| Atomicidade da 053                                                    | 17/17                                                                                                                                                                |
| Concorrência real (duas conexões)                                     | 46/46                                                                                                                                                                |
| E2E completo (`npm run e2e:local`)                                    | 242 testes anteriores + 23 da spec 82 = 265 testes · 264 PASS · 0 FAIL · 1 FALHA CONHECIDA (CN-D) · 0 PULADO · 1893 s; nenhuma conexão externa tentada pelo servidor |
| `lint`, `tsc --noEmit`, `check:workflow`, `git diff --check`, `build` | sem erro                                                                                                                                                             |

Cenários da spec 82: A1 inserção (0 → 1), A2 edição (versão lida; R$ 237,50 / R$ 135,00), A3+A4 conflito
entre abas com rascunho mantido e "manter a minha", A4b "usar o gravado", A5 retry idêntico
(`sem_alteracao` na tela e na API; versão antiga com outro conteúdo = 40001), A6 resposta perdida depois
do COMMIT, A7 turno noturno, A8 virada confirmada pelo admin e registrada (R$ 762,50 / R$ 342,50), A9
mudança de horário invalida a confirmação, A11 apontamento antigo pendente confirmado pela tela, A10
folha fechada (55000) e faturado (42501), C1 banco sem a v2 (PGRST202 simulado) sem fallback, C3+C4
valores v2 = v1 e a v1 ainda aceita; O1–O3+O10 listagem e gravação v2 do operador sem nada financeiro,
O4 duas sessões do operador, O5 admin gravou antes, O6 retry idêntico, O7 virada não autorizada (tela
e API), O8 turno noturno, O9 folha fechada e faturado, C1 sem as v2 sem fallback, C4 v1 do operador
ainda disponível.

### Testes anteriores ajustados (cenário mantido, expectativa trocada pela regra nova)

| Teste                                                                                               | Antes                                            | Agora                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| spec 80 "D1 operador"                                                                               | o operador marcava a confirmação e gravava 22h50 | o operador é bloqueado e orientado; o administrador confirma no apontamento dele; mesmo valor (R$ 915,00 / R$ 456,67) e a confirmação conferida na trilha |
| spec 80 RB1                                                                                         | interceptava `salvar_apontamento_admin`          | intercepta `salvar_apontamento_admin_v2`                                                                                                                  |
| spec 20 (operador pela tela)                                                                        | exigia as v1                                     | exige as v2 e que as v1 NÃO sejam chamadas                                                                                                                |
| `test:operacional`                                                                                  | seis campos; retorno = id da folha               | sete campos; retorno v2 lido; o retorno da v1 passou a ser quebra de contrato                                                                             |
| `test:tela-operacional` L1/L3/L8/L11, F2                                                            | rascunho com todas as linhas; seis campos        | rascunho só das editadas, reconciliado no mesmo escopo; sete campos                                                                                       |
| `test:apontamentos-cp05` A9, B6–B8                                                                  | caixa do operador; `updated_at`; pré-leitura     | sem caixa do operador; `versao`; conflito visível + conferência no banco                                                                                  |
| `test:apontamentos-salvar` D1–D5, D11b; `-c07` E1/E7; `-leitura` E8; `test:interfaces-vigencia` G13 | caminho anterior e RPC v1 na tela                | v2 pelo módulo, sem upsert, sem id gerado, sem caminho anterior                                                                                           |

Nenhum teste foi removido; nenhum risco da SQL 090 mudou de classificação.

**CI do primeiro HEAD (`281107e`):** `validar` e `sql-local` SUCCESS; `e2e-local` falhou em 1 de 265 (spec 80 IJ3). Causa: corrida no TESTE, não erro de gravação. A gravação do operador passou a reler os apontamentos antes de avisar (`onSettled`), o que atrasa o aviso de sucesso; `esperarAviso` lê o primeiro aviso da tela e pegou o de recusa anterior. Correção: o IJ3 espera o aviso de sucesso pelo texto, e na spec 82 cada salvamento espera a resposta da RPC v2 antes de seguir. Specs 80 e 82 de novo no banco limpo: 42/42. O CI do HEAD final está no PR.

## Regressão financeira

Nenhum cálculo mudou: o banco deriva todos os valores (gatilhos), e as RPCs v2 gravam as mesmas
colunas que as v1. Conferido ao centavo: spec 82 A2 (8 h + 1 h de HE = R$ 237,50 / R$ 135,00), A7
(noturno 22–07 = R$ 200,00 / R$ 120,00), A8 (22h50 = R$ 762,50 / R$ 342,50), C3 (a mesma jornada pela
v1 e pela v2 = valores idênticos), C4 (v1 do operador = R$ 200,00 / R$ 120,00); spec 80 inteira (dia
útil, saída antecipada, tolerância, sábado, domingo e feriado, viradas de data, D1 a R$ 915,00 /
R$ 456,67, fechamento e relatório da quinzena); specs 95 e 97 (fechamento, fatura e relatórios) no E2E
completo.

## Compatibilidade de ambientes e sequência segura

O app novo **depende da 054**. Contra um banco sem ela (HML e Production estão na 051), a gravação do
admin e a leitura e a gravação do operador falham de forma controlada (mensagem que cita a 054), sem
gravar nada por outro caminho. Ordem obrigatória, cada passo com autorização nominal por ambiente:

1. validar a 052, a 053 e a 054 no ambiente-alvo (backup, preflights, aplicação, catálogo);
2. conferir catálogo e permissões (as v2, o dono das v2 do operador, o `SELECT(versao)`);
3. publicar este app no ambiente;
4. homologar os fluxos reais (admin, operador, conflito, virada);
5. só então preparar a 058.

## Riscos que permanecem

- **I1 e I7 seguem RISCO** no banco: o app antigo (e a API direta) ainda grava pela v1 e por escrita
  direta, sem versão e sem confirmação, até a 058.
- A tela só reavalia a confirmação quando relê o turno. Se a jornada do turno mudar em outra sessão
  entre a caixa marcada e o salvamento, o banco decide: turno que passou a virar o dia = recusa
  (22023); outra jornada diurna = a confirmação é registrada com a jornada que o banco tem naquele
  momento (é ela que fica na trilha).
- Decisões abertas: DEC-CP05-01 (limite de jornada), jornada zero, presença sem horário; seguem
  AUT-CP07-01, DEC-CP06-04, DEC-CP07-03 e DEC-CP02-01.

## Próximo gate (não autorizado)

Aplicar 052–054 no HML e publicar este app no Preview/HML para homologação, com autorização nominal;
depois Production; só então a 058. Nada disso foi iniciado.
