# QA-BS-01 · CP-02 — Clientes e contratos

Evidência da auditoria do CP-02 (sessão 05, 12/11/2026, sessão em nuvem, Linux). Escopo: tela
`/clientes` (abas Clientes e Contratos e regras, com o bloco de feriados), as condições do contrato
por vigência e a passagem dos dados para operação, apontamento e fechamento. Tudo em Supabase
**local descartável**, com dados sintéticos (`TESTE-AUD-132 CP02 …`), motor por vigência LIGADO,
resolução comercial DESLIGADA e domingo/feriado em dobro LIGADO, como na Production. Nenhum acesso
a HML, Preview ou Production; o registro histórico `01/01/0001` do HML não foi lido.

Testes: `e2e/specs/50-clientes-contratos.spec.ts` (E2E, interface + integração + regra),
`scripts/testar-clientes-contratos.mjs` (`npm run test:clientes-contratos`, regras puras e forma do
código) e a conversão do D3 em `e2e/specs/30-falhas-conhecidas.spec.ts`.

## Regra de negócio de referência

`docs/NEGOCIO.md` §13: "Um cliente pode ter vários contratos e serviços ao mesmo tempo". O sistema
representa isso sem unicidade por cliente (nem por nome): dois contratos do mesmo cliente são
legítimos e não foram tratados como duplicidade. A proteção contra duplicidade é contra o **mesmo
envio repetido** (duplo clique, Enter), não contra cadastros parecidos. Nome igual de cliente
também não é bloqueado: dois clientes com o mesmo nome podem ser empresas diferentes.

## Defeitos

Todos reproduzidos no E2E com o código do HEAD `5a578cb` (RED), corrigidos e revalidados (GREEN).

| ID           | Sev. | Esperado × obtido (antes)                                                                                                                                                                            | Correção                                                                                                                                                                                                        | Regressão                                                     |
| ------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| D3 (cliente) | P2   | Duplo clique em "Salvar cliente": esperado 1 cliente, obtido **2**                                                                                                                                   | trava síncrona de envio único (`src/lib/trava.ts`, a mesma do CP-01) liberada no `onSettled`; botão "Salvando..." desabilitado                                                                                  | CL3 (duplo clique e Enter ×3), 30-falhas (agora PASS); C1, C4 |
| D-CP02-01    | P2   | Duplo clique em "Salvar contrato": esperado 1 contrato e 1 vigência, obtido **2 contratos**                                                                                                          | mesma trava em todos os caminhos de `submitContract` (novo com vigência, edição, motor desligado) e liberação também no caminho que não envia                                                                   | CT2; C2, C3                                                   |
| D-CP02-02    | P2   | Datas do contrato: fim antes do início e ano `0001` (o que o campo de data aceita com o ano digitado pela metade) eram gravados — nem a tela nem o banco conferiam                                   | `errosDasDatasDoContrato` (`clientes/_dominio.ts`): início obrigatório, ano entre 1900 e 2100, fim ≥ início; mensagens na tela e salvar bloqueado                                                               | CT1; B1–B10                                                   |
| D-CP02-03    | P2   | Lista de contratos com o motor por vigência: carregando ou com erro na leitura das vigências, mostrava a **coluna do cadastro** (valor inicial, R$ 250,00) como se fosse o valor de hoje (R$ 320,00) | `useValoresDeHojeComEstado` (novo, mesmo cálculo): a lista mostra "Carregando…" e, esgotadas as tentativas, "Indisponível"; `useValoresDeHoje` mantém assinatura e comportamento para colaboradores e operações | CV1; E1–E3                                                    |
| D-CP02-04    | P2   | Excluir cliente com operação e apontamentos ainda não faturados: o banco apaga tudo em cascata (contratos, operações, turnos, equipe, apontamentos) e a confirmação dizia só "Excluir o cliente X?"  | a confirmação passa a dizer o que vai junto (`consequenciasDaExclusaoDoCliente`). A regra do banco **não** mudou (ver DEC-CP02-02)                                                                              | CL8; D1–D5                                                    |
| D-CP02-05    | P3   | Nome só com espaços era aceito; nome com espaços nas pontas era gravado assim (e aparecia assim no contrato e nas listas)                                                                            | `nomeValido`/`nomeLimpo` para cliente e contrato                                                                                                                                                                | CL1, CL2, CN-A; A1–A5                                         |
| D-CP02-06    | P3   | Falha de rede ao salvar mostrava "TypeError: Failed to fetch"; a exclusão mostrava `error.message` cru (o salvar já traduzia)                                                                        | `mensagemDoErro` reconhece a falha de rede do navegador (só erro sem código); `useDeleteRow` usa a mesma tradução do salvar (mensagens do banco em português continuam iguais)                                  | CL4, CT3; F1–F4                                               |
| D-CP02-07    | P3   | 14 rótulos dos formulários de cliente e contrato não estavam ligados aos campos (leitor de tela, clique no rótulo)                                                                                   | `htmlFor`/`id` em todos                                                                                                                                                                                         | CL1, CT1; G1                                                  |
| D-CP02-08    | P3   | "Salvar cliente" sem estado de carregamento (o botão continuava "Salvar cliente" e habilitado durante o envio)                                                                                       | parte da correção do D3                                                                                                                                                                                         | CL4; C4                                                       |

Nenhum defeito exigiu mudança de SQL, migration, RLS, policy, grant, trigger ou regra financeira.
A conferência de datas ficou na tela de propósito: um `CHECK (valid_to >= valid_from)` faria a
migration falhar onde já exista registro assim (o caso `01/01/0001` do HML) e exige decisão de
saneamento desse dado.

## Decisões pendentes (não implementadas)

| ID          | Situação comprovada                                                                                                                                                                                                                                                                                                                | Por que precisa de decisão                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-CP02-01 | O **Fim do contrato** (e o status Inativo) não limita a cobrança: a vigência inicial das condições é criada aberta por `criar_contrato_com_vigencia`, e editar o fim depois não a encerra. Um dia **depois** do fim do contrato é lançado e cobrado (R$ 320,00 em 22/10 com fim em 20/10). Teste CN-D, etiqueta `@falha-conhecida` | bloquear muda o motor de cobrança e o contrato SQL (CP-05/CP-07); o negócio precisa dizer se o fim do contrato encerra a cobrança, só avisa, ou é só informativo                      |
| DEC-CP02-02 | Excluir cliente sem histórico faturado apaga em cascata as operações e os apontamentos **não faturados** (comprovado no banco)                                                                                                                                                                                                     | é a regra documentada ("cliente só é protegido se tiver fatura ou apontamento faturado"); tornar a exclusão bloqueada com apontamento é mudança de trigger. A tela agora avisa        |
| DEC-CP02-03 | Registro antigo do HML com fim `01/01/0001`                                                                                                                                                                                                                                                                                        | a causa provável é o campo de data sem conferência (D-CP02-02, comprovado localmente); a origem do registro específico não foi verificada e o saneamento exige autorização para o HML |

## Matriz de ações

Tipo: **I** interface · **N** integração entre módulos · **R** regra de negócio/banco.
Status: **PASS** conferido · **CORRIGIDO** reproduzido, corrigido e revalidado · **RISCO** comportamento
registrado com decisão pendente · **N/A** não existe na tela · **NÃO TESTADO** com motivo.

### Clientes

| ID   | Tipo | Ação                                                           | Esperado                                                                        | Obtido                                                                             | Status                                     | Teste          |
| ---- | ---- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------ | -------------- |
| CL1  | I    | Abrir "Novo cliente"; rótulos; nome vazio ou só espaços        | rótulos nomeiam os campos; salvar bloqueado                                     | antes: rótulos soltos, só espaços aceito; depois: conforme                         | CORRIGIDO (D-CP02-05, 07)                  | CL1            |
| CL2  | I/R  | Cadastrar com todos os campos; recarregar                      | todos persistem; nome sem espaços nas pontas                                    | antes: nome com espaços; depois: conforme                                          | CORRIGIDO (D-CP02-05)                      | CL2            |
| CL3  | I/R  | Duplo clique e Enter ×3 em "Salvar cliente"                    | 1 cliente                                                                       | antes: 2; depois: 1 e 1                                                            | CORRIGIDO (D3)                             | CL3, 30-falhas |
| CL4  | I    | Falha de rede; carregamento; nova tentativa                    | português; diálogo aberto; "Salvando..." desabilitado; trava liberada após erro | antes: "TypeError: Failed to fetch", sem carregamento; depois: conforme            | CORRIGIDO (D-CP02-06, 08)                  | CL4            |
| CL5  | I/N  | Editar contato e status Inativo; recarregar                    | persistido; contador "Clientes ativos" −1                                       | conforme                                                                           | PASS                                       | CL5            |
| CL6  | I    | Excluir sem dependência: Cancelar e confirmar                  | Cancelar mantém; confirmar remove (banco e lista)                               | conforme                                                                           | PASS                                       | CL6            |
| CL7  | R    | Excluir cliente faturado                                       | recusa em português; nada muda                                                  | "Cliente com histórico faturado não pode ser excluído. Inative-o."                 | PASS                                       | CL7            |
| CL8  | I/R  | Excluir cliente com operação avulsa e apontamento não faturado | a confirmação diz o que some                                                    | antes: só "Excluir o cliente X?"; depois: cita contratos, operações e apontamentos | CORRIGIDO (D-CP02-04) · regra: DEC-CP02-02 | CL8            |
| CL9  | R    | Excluir cliente cujo contrato tem apontamento                  | recusado; nada some                                                             | recusado em português (trigger do contrato); apontamentos intactos                 | PASS                                       | CL9            |
| CL10 | I    | Busca e filtros na lista                                       | —                                                                               | a tela não tem busca nem filtro                                                    | N/A                                        | —              |
| CL11 | I    | Lista vazia                                                    | estado vazio com orientação                                                     | não exercitado (o banco do E2E já tem clientes)                                    | NÃO TESTADO                                | —              |
| CL12 | I/N  | Autorização da tela e das tabelas                              | só admin                                                                        | coberto no CP-01 (P1 tela, P4 PostgREST) e no 20-seguranca                         | PASS (CP-01)                               | 41-permissoes  |

### Contratos

| ID   | Tipo | Ação                                                                                | Esperado                                                                                                                               | Obtido                                                                                                                     | Status                                                        | Teste                   |
| ---- | ---- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------- |
| CT1  | I/R  | Novo contrato: rótulos, obrigatórios, fim < início, ano 0001                        | rótulos; salvar bloqueado com mensagem                                                                                                 | antes: rótulos soltos, datas aceitas; depois: conforme                                                                     | CORRIGIDO (D-CP02-02, 07)                                     | CT1                     |
| CT2  | I/R  | Duplo clique em "Salvar contrato"                                                   | 1 contrato, 1 vigência                                                                                                                 | antes: 2 contratos; depois: 1 e 1                                                                                          | CORRIGIDO (D-CP02-01)                                         | CT2                     |
| CN-A | N    | Cliente → contrato → operação                                                       | vigência inicial = valores digitados; lista e operação mostram os vínculos; cliente travado com operação                               | conforme; sem botão de tarifas (resolução OFF)                                                                             | PASS                                                          | CN-A                    |
| CN-B | N/R  | Valor A (250 desde 01/10) e B (300 desde 08/10)                                     | cada lançamento usa a condição da sua data; lista mostra o de hoje; histórico com os períodos                                          | 05/10 = 250 (snapshot 250), 09/10 = 300 (snapshot 300); lista R$ 300,00; histórico                                         | PASS                                                          | CN-B                    |
| CN-C | N/R  | Alteração retroativa sobre dia lançado; nova condição; fechamento; renomear cliente | retroativa recusada; lançado congelado; novo dia usa a nova; fechamento soma o congelado; nome novo em contrato, operação e fechamento | recusa "Há apontamentos que usam esta versão…"; 13/10 segue 300; 15/10 = 320; fechamento R$ 2.340,00; nome propagado       | PASS                                                          | CN-C                    |
| CV1  | I    | Lista com erro / lentidão ao ler as vigências                                       | nunca mostra a coluna do cadastro como valor de hoje                                                                                   | antes: R$ 250,00 (cadastro) no lugar de R$ 320,00; depois: "Carregando…", depois "Indisponível"; R$ 320,00 quando responde | CORRIGIDO (D-CP02-03)                                         | CV1                     |
| CN-D | N/R  | Fim do contrato 20/10; lançar 22/10                                                 | decisão de negócio                                                                                                                     | lançado e cobrado R$ 320,00; vigência das condições aberta                                                                 | RISCO (DEC-CP02-01)                                           | CN-D `@falha-conhecida` |
| CT3  | I/R  | Excluir contrato sem uso; excluir contrato usado                                    | sem uso: remove com as vigências; usado: recusa em português                                                                           | conforme                                                                                                                   | PASS                                                          | CT3                     |
| CT4  | I    | Editar contrato com o motor ligado                                                  | diária/fator/tolerância só pelo bloco "Condições do contrato"                                                                          | conforme (CN-B, CN-C)                                                                                                      | PASS                                                          | CN-B                    |
| CT5  | I    | Tarifas por função e diárias individuais                                            | só com a resolução ligada                                                                                                              | resolução OFF (Production): botão ausente e diária genérica exibida                                                        | PASS (OFF) · ON NÃO TESTADO (desligado em todos os ambientes) | CN-A                    |
| CT6  | R    | Contrato com valor zero ou negativo                                                 | —                                                                                                                                      | o banco recusa negativo (CHECK); zero é aceito; não exercitado pela tela                                                   | NÃO TESTADO                                                   | —                       |

### Feriados (aba Contratos e regras)

| ID  | Tipo | Ação                                                                | Esperado                   | Obtido                                | Status          | Teste    |
| --- | ---- | ------------------------------------------------------------------- | -------------------------- | ------------------------------------- | --------------- | -------- |
| FE1 | I/R  | Registrar (motivo obrigatório), data repetida, aposentar com motivo | conforme as regras da tela | conforme                              | PASS            | FE1      |
| FE2 | N    | Feriado dobra o dia lançado                                         | dobro                      | coberto pelo 10-ciclo (feriado 12/10) | PASS (10-ciclo) | 10-ciclo |

## Matriz de valores e vigências (contrato A)

| Data  | Vigência                                | Definido                 | Vigente na data | Coluna `contracts.daily_rate` | Exibido na lista | Aplicado / congelado | Exportado         |
| ----- | --------------------------------------- | ------------------------ | --------------- | ----------------------------- | ---------------- | -------------------- | ----------------- |
| 05/10 | 01/10–08/10                             | 250                      | 250             | 250 (inicial, nunca muda)     | —                | 250 / snapshot 250   | fechamento        |
| 09/10 | 08/10–14/10                             | 300                      | 300             | 250                           | —                | 300 / 300            | fechamento        |
| 13/10 | 08/10–14/10                             | (tentativa 320 recusada) | 300             | 250                           | —                | 300 / 300            | fechamento        |
| 15/10 | 14/10 em diante                         | 320                      | 320             | 250                           | R$ 320,00 (hoje) | 320 / 320            | fechamento        |
| 22/10 | 14/10 em diante (fim do contrato 20/10) | —                        | 320             | 250                           | —                | 320 / 320            | RISCO DEC-CP02-01 |

Fechamento da 1ª quinzena de outubro (dois colaboradores por dia): 2×250 + 2×300 + 2×300 + 2×320 =
**R$ 2.340,00**, igual ao esperado calculado à mão. Nenhuma diferença entre esperado e obtido nos
valores; as diferenças encontradas foram de interface (D-CP02-03) e de regra pendente (DEC-CP02-01).

## Riscos residuais e dependências

- **CP-04 (operações):** o formulário de operação oferece clientes e contratos inativos ou com fim
  já passado, sem distinção.
- **CP-05 (apontamentos):** salvar o dia grava a equipe inteira do turno, mesmo quando só uma linha
  foi editada (observado; é o modelo da folha do dia, não alterado).
- **CP-03 (colaboradores):** `useValoresDeHoje` de colaborador consulta todos os IDs num único
  `.in(...)`; para contratos são duas requisições por contrato (página e contagem) — custo cresce
  com a lista, sem erro de valor. A forma com estado agora existe e pode ser adotada no CP-03.
- **CP-09:** exclusões continuam no `window.confirm` nativo (D8); o texto agora diz as consequências.
- Valor zero de diária é aceito pelo banco e pela tela (sem regra de negócio que o proíba).

## Resultados

- **RED (código do `5a578cb`)**, primeira execução do `50-clientes-contratos`: 15 falhas, das quais
  9 eram defeitos reais (rótulos de cliente e de contrato soltos; nome gravado com espaços e
  contrato ligado ao cliente " … Cliente A "; 2 clientes no duplo clique; "TypeError: Failed to
  fetch"; confirmação sem consequências; 2 contratos no duplo clique; R$ 250,00 do cadastro na
  lista com erro). As demais eram consequência dessas ou ajuste do próprio teste (seletor ambíguo,
  leitura do aviso antes da hora, tentativas do TanStack Query antes do erro).
- **GREEN, sessão em nuvem (Linux, Node 22.23, Docker local):** lint, `tsc`, `check:workflow`,
  `git diff --check` PASS; **74/74** `test:*` (nova `test:clientes-contratos` 32/32); build PASS
  (placeholders da CI); travas 25/25; `npm run e2e:local` completo: **116 testes, 111 PASS, 0 FAIL,
  5 FALHA CONHECIDA, 0 PULADO**, 713 s, nenhuma rede externa, encerramento sem sobras; `sql-local`
  52 suítes PASS.
- **Falhas conhecidas:** D3 em cliente saiu da lista (o teste do `30-falhas-conhecidas` agora
  confere 1 cliente, sem a etiqueta); entrou o CN-D (DEC-CP02-01). Seguem B3 (D1), D3 em turno
  (CP-04), "Alterar custo" (D2, CP-03) e a confirmação da fatura (D4, CP-07).
- **CP-01 íntegro:** `40-autenticacao` e `41-permissoes` PASS na mesma execução;
  `test:mensagens-auth` 27/27 (a trava passou para `src/lib/trava.ts`, reexportada pela tela de
  usuários).
