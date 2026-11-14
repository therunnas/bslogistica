# QA-BS-01 · CP-03 — Colaboradores e valores

Evidência da auditoria do CP-03 (sessão 06, 12/11/2026, sessão em nuvem, Linux). Escopo: tela
`/colaboradores` (cadastro, catálogo de funções, "Alterar custo", histórico, valores de hoje) e a
passagem do **custo do colaborador** para equipe, apontamento, fechamento e relatórios. Custo do
colaborador não é preço cobrado do cliente: cada conferência abaixo diz qual dos dois mede.

Tudo em Supabase **local descartável**, dados sintéticos (`TESTE-AUD-132 CP03 …`), motor por
vigência LIGADO, resolução comercial DESLIGADA, domingo/feriado em dobro LIGADO, como na Production.
Nenhum acesso a HML, Preview ou Production.

Testes: `e2e/specs/60-colaboradores-custos.spec.ts` (E2E: interface, integração e regra),
`scripts/testar-colaboradores-custos.mjs` (`npm run test:colaboradores-custos`),
`scripts/testar-vigencias-paginacao.mjs` bloco F (leitura em lotes) e a conversão do D2 em
`e2e/specs/30-falhas-conhecidas.spec.ts`.

## Defeitos

Reproduzidos no código do HEAD `b8f08f7` (RED), corrigidos e revalidados (GREEN).

| ID        | Sev. | Esperado × obtido (antes)                                                                                                                                                                                                                                                                                                                                                                                                    | Correção                                                                                                                                                                                                                                                     | Regressão                                                                     |
| --------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| D2        | P1   | "Alterar custo": digitar 199 e trocar a data para a de um valor existente (ou anterior ao primeiro) devolvia o campo para **150** sem aviso — o salvar gravaria o custo antigo como correção                                                                                                                                                                                                                                 | `valor-atual.tsx`: os campos digitados ficam marcados e trocar a data só preenche os não tocados (`manterDigitados`, `src/lib/vigencias-ui.ts`); abrir de novo zera as marcas. Vale para os três "Alterar" (custo, condições do contrato, valor da operação) | D2, 30-falhas (agora PASS); A1–A5                                             |
| D-CP03-01 | P2   | Lista com **300 colaboradores**: esperado o custo de hoje (R$ 199,00), obtido o custo do cadastro (**R$ 150,00**). Os IDs iam todos num único `.in(...)` na URL: acima de ~250 a URL passa de 8 KB e o gateway responde **414 URI Too Long** (medido: 200 IDs → OK, 300 → 414); a falha caía no recuo silencioso para a coluna                                                                                               | `lerCustosDosColaboradores` lê em lotes de 100 IDs (mesma consulta, mesmos filtros; erro em um lote derruba a leitura inteira, nunca devolve parcial). Vale também para Operações e Apontamentos, que usam a mesma função                                    | VH2; paginação F1–F5 (RED comprovado: a versão anterior lança "URI Too Long") |
| D-CP03-02 | P2   | Leitura dos custos com erro ou lenta: a lista e o cartão "Custo médio" mostravam a coluna do cadastro (R$ 150,00) como custo de hoje (R$ 199,00)                                                                                                                                                                                                                                                                             | `useValoresDeHojeComEstado` (criado no CP-02): "Carregando…" e, esgotadas as tentativas, "Indisponível" na célula e no cartão                                                                                                                                | VH1; C1, C2                                                                   |
| D-CP03-03 | P2   | Duplo clique em "Salvar colaborador": esperado 1, obtido **2** colaboradores (cada um com a sua vigência inicial)                                                                                                                                                                                                                                                                                                            | trava de envio único (`src/lib/trava.ts`), liberada no `onSettled` e no caminho que não envia                                                                                                                                                                | CB3 (duplo clique e Enter ×3); B7                                             |
| D-CP03-04 | P3   | Nome só com espaços aceito; espaços das pontas gravados (e propagados para equipe, apontamento e relatório)                                                                                                                                                                                                                                                                                                                  | `nomeValido`/`nomeLimpo` (os mesmos de clientes)                                                                                                                                                                                                             | CB1, CB2; B1, B2, B6                                                          |
| D-CP03-05 | P3   | Custo negativo digitado ia ao banco e voltava como erro genérico                                                                                                                                                                                                                                                                                                                                                             | `errosDoCusto`: mensagem "O custo por diária não pode ser negativo." e salvar bloqueado (zero continua aceito: não há regra que o proíba)                                                                                                                    | CB1; B3–B5                                                                    |
| D-CP03-06 | P3   | Rótulo "Status" do formulário não estava ligado ao seletor                                                                                                                                                                                                                                                                                                                                                                   | `htmlFor`/`id`                                                                                                                                                                                                                                               | CB1, CB5; B8                                                                  |
| D-CP03-07 | P2   | Duplo clique em "Salvar novo valor" ("Alterar custo"/"Alterar condições"/"Alterar valor"): o valor era gravado, mas o diálogo **ficava aberto** oferecendo "Corrigir valor". O TanStack Query só executa o `onSuccess` da última chamada de `mutate`: o sucesso da primeira (que fecha) era descartado e a segunda falhava por sobreposição. **Intermitente**: passou em duas execuções e falhou na execução completa do E2E | trava de envio único no `salvar` do `valor-atual.tsx`                                                                                                                                                                                                        | D2b; A6                                                                       |

Nenhum defeito exigiu mudança de SQL, migration, RLS, policy, grant, trigger ou regra de custo.

## Matriz de ações

Tipo: **I** interface · **N** integração · **R** regra/banco. Status: **PASS** conferido ·
**CORRIGIDO** reproduzido, corrigido e revalidado · **N/A** não existe · **NÃO TESTADO** com motivo.

| ID  | Tipo | Ação                                                                                                       | Esperado                                                                                       | Obtido                                                                                                                                                            | Status                        | Teste                |
| --- | ---- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------- |
| FN1 | I/R  | Catálogo: cadastrar, Enter repetido, nome repetido (acento/maiúscula/espaço), renomear, inativar, reativar | 1 função; repetido bloqueado; renomear e situação persistem                                    | conforme                                                                                                                                                          | PASS                          | FN1                  |
| FN2 | R    | Excluir função                                                                                             | não existe exclusão (só inativar), por regra do banco                                          | conforme                                                                                                                                                          | N/A                           | —                    |
| CB1 | I/R  | Novo colaborador: rótulos, nome vazio/só espaços, custo negativo                                           | rótulos; salvar bloqueado com mensagem                                                         | antes: "Status" solto, só espaços aceito, negativo enviado; depois: conforme                                                                                      | CORRIGIDO (D-CP03-04, 05, 06) | CB1                  |
| CB2 | I/R  | Cadastrar com função, documento, telefone, custo e início                                                  | tudo persiste; vigência inicial = custo e data digitados; nome limpo                           | antes: nome com espaços; depois: conforme                                                                                                                         | CORRIGIDO (D-CP03-04)         | CB2                  |
| CB3 | I/R  | Duplo clique e Enter ×3 em "Salvar colaborador"                                                            | 1 colaborador e 1 vigência                                                                     | antes: 2; depois: 1                                                                                                                                               | CORRIGIDO (D-CP03-03)         | CB3                  |
| CB4 | I    | Falha de rede ao cadastrar; nova tentativa                                                                 | português; nada gravado; segunda tentativa grava 1                                             | conforme (já no HEAD anterior)                                                                                                                                    | PASS                          | CB4                  |
| CB5 | I/R  | Editar telefone e status Inativo; recarregar                                                               | persiste; cartão "Inativos" +1; custo travado (só por "Alterar custo"); nenhuma vigência nova  | conforme                                                                                                                                                          | PASS                          | CB5                  |
| CB6 | I/R  | Excluir com apontamento; Cancelar; excluir sem dependência                                                 | com apontamento: "Exclusão recusada: há apontamento não faturado…"; sem: removido              | conforme                                                                                                                                                          | PASS                          | CB6                  |
| CB7 | I    | Reativar colaborador                                                                                       | o mesmo seletor de Status (Inativo → Ativo)                                                    | coberto por CB5 (mesmo campo)                                                                                                                                     | PASS                          | CB5                  |
| CB8 | I    | Busca e filtros na lista                                                                                   | —                                                                                              | a tela não tem                                                                                                                                                    | N/A                           | —                    |
| D2  | I/R  | "Alterar custo": digitar, trocar a data três vezes, Cancelar e reabrir                                     | o digitado permanece; reabrir volta ao valor e data de hoje                                    | antes: voltava para 150; depois: conforme                                                                                                                         | CORRIGIDO (D2)                | D2                   |
| D2b | I/R  | "Alterar custo": erro de rede, nova tentativa com duplo clique                                             | português; digitado mantido; 1 versão; diálogo fecha; sem aviso de erro; banco e lista com 199 | erro de rede e versão única já conformes; o diálogo ficava aberto depois do duplo clique de forma intermitente (falhou na 1ª execução completa); depois: conforme | CORRIGIDO (D-CP03-07)         | D2b                  |
| VH1 | I    | Lista com erro / lentidão ao ler os custos                                                                 | nunca o custo do cadastro como atual                                                           | antes: R$ 150,00; depois: "Carregando…", "Indisponível" (célula e custo médio), R$ 199,00 ao responder                                                            | CORRIGIDO (D-CP03-02)         | VH1                  |
| VH2 | I/R  | Lista com 300 colaboradores                                                                                | custo de hoje; nenhuma resposta 4xx                                                            | antes: R$ 150,00 (414); depois: R$ 199,00, sem erro                                                                                                               | CORRIGIDO (D-CP03-01)         | VH2                  |
| HI1 | I    | Histórico de custos                                                                                        | períodos visíveis em "Ver histórico"                                                           | conferido pelo histórico de contratos (mesmo componente, CN-B do CP-02); para custo, pelo banco em cada cenário                                                   | PASS                          | CN-B (CP-02), CN-B/C |
| AU1 | R    | Autorização (tela e tabela)                                                                                | só admin                                                                                       | CP-01 P1/P4 e 20-seguranca (operador lê 0 linha de `employees`)                                                                                                   | PASS (CP-01)                  | 41-permissoes        |
| EV1 | I    | Lista vazia                                                                                                | estado vazio                                                                                   | não exercitado (o banco do E2E já tem colaboradores)                                                                                                              | NÃO TESTADO                   | —                    |

## Cenários de integração e reconciliação

Colaborador Zeca na operação fixa do contrato a R$ 250,00/diária (preço ao cliente), turno de 8 h.

| Data  | Vigência do custo | Custo-base (vigente) | Horas             | Custo do lançamento (esperado = obtido) | Snapshot do custo     | Receita (preço ao cliente)         |
| ----- | ----------------- | -------------------- | ----------------- | --------------------------------------- | --------------------- | ---------------------------------- |
| 05/10 | 01/10–08/10       | 150,00               | 8 h               | 150,00                                  | 150,00 (versão 01/10) | 250,00                             |
| 07/10 | 01/10–08/10       | 150,00               | 8 h               | 150,00                                  | 150,00 (versão 01/10) | 250,00                             |
| 09/10 | 08/10–14/10       | 250,00               | 8 h               | 250,00                                  | 250,00 (versão 08/10) | 250,00                             |
| 13/10 | 08/10–14/10       | 250,00               | 10 h (2 h extras) | 250 + 2 × 250/8 = **312,50**            | 250,00                | 250 + 2 × 250/8 × 1,5 = **343,75** |
| 15/10 | 14/10 em diante   | 270,00               | 8 h               | 270,00                                  | 270,00 (versão 14/10) | 250,00                             |
| 16/10 | 14/10 em diante   | 270,00               | 8 h               | 270,00                                  | 270,00                | 250,00                             |

Lia (custo 180,00 desde 01/10) em 15/10: custo 180,00, receita 250,00. Dia 15/10: 2 lançamentos,
custo 450,00, receita 500,00 (sem duplicidade).

Período 01–15/10 (fechamento da 1ª quinzena): custo previsto Zeca 150 + 150 + 250 + 312,50 + 270 =
1.132,50, Lia 180 → **R$ 1.312,50**; receita 250 × 5 + 343,75 + 250 = **R$ 1.593,75**. Relatório por
colaborador no mesmo período: Zeca **R$ 1.132,50**, Lia **R$ 180,00**. Lista de colaboradores (hoje,
12/11): R$ 270,00 (Zeca). Coluna `employees.daily_cost`: continua no custo inicial (150), por
desenho — por isso a lista lê a vigência, e nunca recua para a coluna sem avisar.

**Esperado × obtido: nenhuma divergência ao centavo** em cadastro, vigência, snapshot, custo do
lançamento, fechamento e relatório. Custo-base (diária do colaborador), custo efetivo do lançamento
(com hora extra), receita (preço do contrato) e margem ficam separados: o fechamento mostra custo e
receita em cartões distintos.

- **Cenário A (custo inicial):** 150 no cadastro, na vigência inicial, no snapshot (versão 01/10), no
  custo do lançamento e no fechamento (R$ 150,00 de custo × R$ 250,00 de receita).
- **Cenário B (reajuste 150 → 250 em 08/10):** cada dia usa o custo da sua data; a hora extra do
  custo usa o custo vigente (250/8 por hora); o lançado antes não muda.
- **Cenário C (alteração posterior e retroativa):** novo custo em 09/10 (dia já lançado) recusado
  pelo banco — "Há apontamentos que usam esta versão em datas a partir de …" — com o valor digitado
  mantido na tela; novo custo em 14/10 aceito; nenhum lançamento anterior reescrito.
- **Cenário D (dois profissionais):** custos individuais, total do dia, período e relatório
  conferidos.
- **Cenário E (função):** trocar a função profissional do colaborador não muda o custo (a vigência
  da data decide) e não reescreve a função da alocação já feita: o lançamento grava a função de
  trabalho da equipe da operação (`operation_team.job_function_id`), copiada na alocação. Função
  profissional e categoria comercial não são tratadas como equivalentes; com a resolução comercial
  desligada a função não altera preço nem custo.

## Testes RED/GREEN

- **RED** (`b8f08f7`), primeira execução do `60-colaboradores-custos`: 13 falhas, das quais 6 eram os
  defeitos acima ("Status" solto; nome com espaços; 2 colaboradores no duplo clique; D2 199 → 150;
  R$ 150,00 com erro de leitura; R$ 150,00 com 300 colaboradores) e as outras 7 consequência do nome
  gravado com espaços (os cenários procuravam "Zeca" e o banco tinha " Zeca "). FN1, CB4 e D2b
  passavam. Bloco F da paginação com a função anterior: "ErroPaginacao … URI Too Long".
- **RED intermitente (D-CP03-07):** com o D2 já corrigido, a primeira execução completa do E2E
  falhou no D2b (diálogo aberto com "Corrigir valor" depois do duplo clique, valor gravado). A
  causa é de corrida e não aparecia nas execuções parciais; a correção a elimina por construção (um
  único `mutate`), e a suíte confere a forma (A6).
- **GREEN:** ver "Resultados".

## Pendências e dependências

- **CP-04:** a tela de Operações ainda usa `useValoresDeHoje` sem estado para custos, contratos e
  valores da operação (o recuo silencioso continua ali; a leitura em lotes já vale). Trocar a função
  de trabalho de quem já está alocado é feito na equipe da operação.
- **CP-05:** salvar o dia grava a equipe inteira do turno (observado no CP-02, confirmado aqui).
- **CP-09:** exclusões continuam no `window.confirm` nativo (D8).
- Custo zero é aceito pelo banco e pela tela (sem regra de negócio que o proíba).
- As decisões do CP-02 (DEC-CP02-01 a 03) seguem pendentes e não foram tocadas.

## Resultados

- **GREEN, sessão em nuvem (Linux, Node 22.23, Docker local):** lint, `tsc`, `check:workflow`,
  `git diff --check` PASS; **75/75** `test:*` (nova `test:colaboradores-custos` 17/17;
  `test:vigencias-paginacao` 31/31 com o bloco F); build PASS (placeholders da CI); travas 25/25;
  `npm run e2e:local` completo: **132 testes, 128 PASS, 0 FAIL, 4 FALHA CONHECIDA, 0 PULADO**, 880 s,
  nenhuma rede externa, encerramento sem sobras; `sql-local` 52 suítes PASS.
- **Falhas conhecidas:** D2 saiu da lista (o teste do `30-falhas-conhecidas` agora confere o valor
  mantido, sem a etiqueta). Seguem B3/D1 (CP-05), D3 em turno (CP-04), confirmação da fatura (D4,
  CP-07) e CN-D (DEC-CP02-01).
- **CP-01 e CP-02 íntegros:** `40-autenticacao`, `41-permissoes` e `50-clientes-contratos` PASS na
  mesma execução; `test:mensagens-auth` e `test:clientes-contratos` PASS.
