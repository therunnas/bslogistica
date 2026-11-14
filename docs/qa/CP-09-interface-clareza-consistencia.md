# QA-BS-01 · Sessão 14 — CP-09 (Interface, clareza e consistência)

Sessão 14 (13/11/2026, sessão em nuvem, Linux, Supabase local descartável). Base: HEAD
`6a23dc4565ac077b396c77fd2354dbcbb0540c84` (sessão 13 / CP-08). PR #134 (Draft).

Escopo autorizado: auditar as telas existentes e corrigir defeitos de interface comprovados
(usabilidade, apresentação, acessibilidade, navegação, estados, responsividade, formulários e
diálogos), D8, R-CP07-06 e R-CP08-01 a 03; R-CP08-04 só registrado. **Sem redesign, sem
funcionalidade financeira nova, sem mudança de regra de cobrança.** Nenhuma migration, schema,
função/contrato de RPC, RLS, grant, trigger ou fórmula financeira foi alterada; cobrança por
produção, catálogo de serviços e painel de Contêineres **não** foram criados.

## Isolamento

- HEAD local = remoto no início; árvore limpa (só `supabase/.branches/`, não versionado). Os
  scripts remotos antigos seguem desativados (`*.REMOTO-NAO-EXECUTAR`) e não foram usados.
- Só Supabase local (`bs-e2e-cp04` para iteração, `bs-e2e-cp09` para o E2E oficial,
  `bs-fin11-cp09` para o SQL), criados e encerrados pelo próprio `project_id`; `config.toml`
  restaurado depois de cada uso. GitHub só para a CI do #134.
- Nenhum acesso a HML, Preview ou Production; nenhuma API de gerenciamento remoto. O incidente das 4
  chamadas vazias ao HML (CP-04/CP-05) continua registrado e não se repetiu.

## Método

Para cada defeito: reprodução no navegador real (Chromium do Playwright) contra o build do
`6a23dc4` (**RED**), causa no código, correção mínima, **GREEN** no novo build, regressão. A
auditoria automática da spec 98 (`auditar()`) percorre cada tela em 390 × 844 (celular),
768 × 1024 (tablet) e 1366 × 768 (notebook) e acusa: rolagem lateral do documento, botão ou link
sem nome acessível, campo sem rótulo (ignorando o `<select>` nativo escondido do Radix, com
`aria-hidden`) e diálogo mais largo que a tela. Os diálogos de cadastro são abertos e auditados
em celular e notebook.

## Inventário das telas

| Tela / rota                                                                       | Auditoria automática                                           | Achados                                                                                                                                                 | Estado                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `/dashboard`                                                                      | 3 tamanhos                                                     | De/Até sem rótulo ligado (D-CP09-01); "Diárias" sem dizer domingo/feriado (R-CP08-01); margem "0,0%" sem receita (R-CP08-02)                            | corrigido                                                              |
| `/clientes` (Clientes e a aba Contratos e regras)                                 | 3 tamanhos + diálogos Novo cliente, Novo contrato              | exclusão de cliente e contrato por `window.confirm` (D8); "Alterar condições" de contrato que só começa no futuro (R-CP07-06)                           | corrigido                                                              |
| `/colaboradores`                                                                  | 3 tamanhos + diálogo Novo colaborador                          | exclusão por `window.confirm` (D8); "Alterar custo" usa o mesmo componente (R-CP07-06)                                                                  | corrigido                                                              |
| `/operacoes` (operações, turnos, equipes)                                         | 3 tamanhos + diálogo Nova operação                             | exclusão de operação e turno por `window.confirm` (D8); a Nova operação nomeia "contêiner" sem dizer que a cobrança é por diária (D-CP09-03)            | corrigido                                                              |
| `/operacoes/avulsos-antigos/<id>` (e `/containers/*`, que redirecionam)           | não (coberto no CP-06/CP-06B)                                  | —                                                                                                                                                       | sem alteração                                                          |
| `/apontamentos`                                                                   | 3 tamanhos                                                     | Operação/Turno/Data sem rótulo ligado (D-CP09-01)                                                                                                       | corrigido                                                              |
| `/fechamento`                                                                     | 3 tamanhos                                                     | nenhum                                                                                                                                                  | sem alteração                                                          |
| `/faturamento`                                                                    | 3 tamanhos + diálogo Novo adicional                            | Cliente/De/Até e "Operação (opcional)" do adicional sem rótulo ligado (D-CP09-01); "Diárias" e margem (R-CP08-01/02); CSV com ponto decimal (R-CP08-03) | corrigido                                                              |
| `/relatorios`                                                                     | 3 tamanhos                                                     | De/Até sem rótulo ligado (D-CP09-01); "Diárias" e margem (R-CP08-01/02); CSV com ponto decimal (R-CP08-03)                                              | corrigido                                                              |
| `/usuarios`, `/configuracoes`, `/implantacao-vigencias`                           | 3 tamanhos                                                     | nenhum (já usam `AlertDialog`)                                                                                                                          | sem alteração                                                          |
| `/login`, `/esqueci-senha`                                                        | 3 tamanhos                                                     | nenhum                                                                                                                                                  | sem alteração                                                          |
| `/mfa`, `/redefinir-senha`, `/redefinir-senha/mfa`, `/auth/confirmar-recuperacao` | **não** (exigem sessão AAL1 com fator ou token de recuperação) | —                                                                                                                                                       | NÃO TESTADO nesta sessão (fluxos cobertos funcionalmente pela spec 40) |
| `/operacional` (operador)                                                         | 390 px                                                         | sem título (`h1`) enquanto carrega, na falha e sem operação atribuída (D-CP09-02); Operação/Turno/Data sem rótulo ligado (D-CP09-01)                    | corrigido                                                              |

**Responsividade:** nenhuma tela teve rolagem lateral do documento nos três tamanhos, nem antes nem
depois. As tabelas largas rolam dentro do próprio cartão (comportamento existente, mantido). Todos
os diálogos de cadastro cabem em 390 px.

## Defeitos RED/GREEN

RED no build do `6a23dc4`: spec 98 com **13 falhas e 4 passes** (17 casos); o OP1, escrito depois,
falhou também no build anterior à correção (1/1). GREEN: **18/18**.

| ID        | P   | Defeito (RED)                                                                                                                                                                                                                                                                | Causa                                                                                  | Correção                                                                                                                                                                                                                                                                                                                                                                                                                       | Teste                                                     |
| --------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| D8        | P3  | Exclusão de cliente, contrato, colaborador, operação e turno pelo `window.confirm` nativo: fora do padrão visual do sistema, sem controle de foco nem do texto (o navegador decide a aparência)                                                                              | `if (!window.confirm(...)) return;` em três telas                                      | `useConfirmacaoDeExclusao()` (`_components/confirmacao-de-exclusao.tsx`): `AlertDialog` com o mesmo texto de antes (`mensagemDaExclusao`: o que sai, o que vai junto, "não pode ser desfeita"), foco inicial em **Cancelar**, Esc fecha, **Excluir** destrutivo. A mutação só roda no callback de confirmar. **Nenhuma regra do banco mudou:** cliente faturado continua recusado (CL7), lançamento faturado continua imutável | D8, D8b; CL7 (spec 50); `test:interface-cp09` A1–A6       |
| R-CP07-06 | P2  | Contrato que só começa no futuro (primeira versão em 01/08/2027): "Alterar condições" com data **depois** da primeira versão abria com os campos vazios e "Salvar" desabilitado (VF1: `daily_rate` = "")                                                                     | a base do formulário era o "valor de hoje", que não existe antes da primeira versão    | `versaoNaData(data)`: a versão que vale na data escolhida — a da própria data (corrigir), a primeira quando a data é anterior a ela (antecipar) ou a última que começa antes dela. É a semântica de vigência já existente (registrar, corrigir, antecipar); **nenhuma regra de retroatividade nova** — o banco segue recusando o que recusava                                                                                  | VF1, VF2; `test:colaboradores-custos` A4, A5, A5c         |
| R-CP08-01 | P3  | "Diárias" contava domingo/feriado (cobrados por hora no V2) sem dizer                                                                                                                                                                                                        | a contagem é `dailies` (1 por presença), o mesmo que a fatura grava em `total_dailies` | **só o texto:** "inclui N de domingo ou feriado, cobrado por hora" no Dashboard, Relatórios e Faturamento. A contagem e `total_dailies` não mudaram                                                                                                                                                                                                                                                                            | IN1; `test:interface-cp09` B1–B4                          |
| R-CP08-02 | P3  | Sem receita no período, a margem percentual aparecia "0,0%" ao lado de margem negativa                                                                                                                                                                                       | `marginPct` devolve 0 sem receita                                                      | `percentualDaMargem`: "sem receita no período" quando a receita é zero ou negativa; com receita, o mesmo número e formato de antes. Vale também para as linhas por cliente (Dashboard) e por operação (Relatórios). `marginPct` não mudou                                                                                                                                                                                      | IN2; `test:interface-cp09` C1–C3                          |
| R-CP08-03 | P3  | CSV de lançamentos (Relatórios e Faturamento) com ponto decimal; o do Fechamento usa vírgula. Prova no LibreOffice em pt-BR (filtro CSV `59,34,76,1,,1046`): ponto → célula de **texto** (`t="s"`); vírgula → célula **numérica** (`t="n"`)                                  | `toFixed(2)`                                                                           | `reaisNoCsv`: os mesmos dígitos de `toFixed(2)`, com vírgula e sem separador de milhar; "-0.00" vira "0,00". **Os valores não mudaram**                                                                                                                                                                                                                                                                                        | CSV1; EX1 (specs 95 e 97); `test:interface-cp09` D1–D3    |
| D-CP09-01 | P3  | 12 campos com rótulo visível mas **não ligado** (leitor de tela não anuncia, clicar no rótulo não foca): Dashboard De/Até; Relatórios De/Até; Faturamento Cliente/De/Até; adicional "Operação (opcional)"; Apontamentos Operação/Turno/Data; Operacional Operação/Turno/Data | `<Label>` sem `htmlFor` e campo sem `id`                                               | `htmlFor`/`id` (`dashboard-inicio`, `relatorios-fim`, `faturamento-cliente`, `adicional-operacao`, `apontamentos-turno`, `operacional-data`…). O rótulo continua imediatamente antes do campo                                                                                                                                                                                                                                  | AU (3 tamanhos), AU diálogos; `test:interface-cp09` E1–E2 |
| D-CP09-02 | P3  | `/operacional` sem título enquanto carrega, na falha de leitura e sem operação atribuída                                                                                                                                                                                     | o `return` antecipado vinha antes do `PageHeader`                                      | o cabeçalho "Apontamento" aparece nos três estados                                                                                                                                                                                                                                                                                                                                                                             | AU operador; `test:interface-cp09` F1                     |
| D-CP09-03 | P3  | A Nova operação lista "contêiner" entre os serviços avulsos sem dizer como se cobra — lê-se como cobrança por contêiner, que **não existe** (NEGOCIO.md §3A)                                                                                                                 | texto do CP-06B falava só da modalidade                                                | uma frase: "A cobrança é por diária de cada participante; cobrar por quantidade executada (ex.: por contêiner) ainda não existe no sistema." Nenhum campo novo, nenhum campo fictício de forma de cobrança ou catálogo                                                                                                                                                                                                         | OP1; `test:interface-cp09` G1–G2                          |

## Estados, teclado e segurança

- **Teclado e foco:** a confirmação de exclusão abre com o foco em Cancelar (Enter sem querer não
  apaga); Esc fecha sem excluir; Excluir é o único botão destrutivo. Os demais diálogos já usavam
  `AlertDialog`/`Dialog` do Radix (foco preso, Esc fecha) — conferido por leitura e pela auditoria.
- **Carregando, erro, vazio:** sem mudança nas telas do admin (já tinham os três estados desde os
  CPs anteriores); no operador, o título passa a aparecer nos três (D-CP09-02).
- **Segurança:** nada do que a tela mostra ou envia mudou de autoridade. A exclusão continua
  decidida pelo banco (CL7: cliente faturado é recusado com a mensagem em português, nada muda);
  os rótulos e textos não expõem dado financeiro ao operador (a spec 20 e a 41 continuam PASS).

## Exportações (R-CP08-03)

| Exportação                                 | Antes                              | Agora             |
| ------------------------------------------ | ---------------------------------- | ----------------- |
| Fechamento (CSV)                           | vírgula decimal                    | sem alteração     |
| Relatórios — "Exportar lançamentos (CSV)"  | `240.00` (texto na planilha pt-BR) | `240,00` (número) |
| Faturamento — "Exportar lançamentos (CSV)" | `240.00`                           | `240,00`          |

Separador de colunas `;`, BOM UTF-8 e neutralização de fórmula (`montarCsv`) sem alteração. O
valor de cada célula é o mesmo de antes: só o separador decimal mudou (`test:interface-cp09` D2).

## R-CP08-04 — lacuna registrada (não implementada)

Não há relatório por cliente nem por tipo de serviço: o tipo é identificado no **nome** da
operação (DEC-CP06-01, catálogo) e o Dashboard só tem "Receita x custo por cliente" em gráfico de
apontamentos. Implementar exige decidir o catálogo; fica fora do CP-09.

## Matriz de gates financeiros

Classificação para um **piloto em Production só com contas admin, cobrança por diária e sem
registros antigos de contêiner** (o estado de Production comprovado em PROD-051-01: sem dados de
negócio). Fora dessas condições a classificação muda e está dita em cada linha.

| #   | Item                                                                                       | Estado no código (comprovado)                                                                      | Classificação                                      | Justificativa                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cobrança por produção (quantidade × preço unitário)                                        | **não existe**; contêiner por unidade sai como diária × participantes (diverge, NEGOCIO_X_SISTEMA) | **DECISÃO PENDENTE** (DEC-PROD-01/02, DEC-CP06-02) | bloqueante **se** o piloto tiver serviço cobrado por quantidade; não bloqueante para piloto só por diária. A tela agora diz que não existe (D-CP09-03)                                                                                                                |
| 2   | Catálogo de tipos de serviço                                                               | não existe; tipo no nome da operação                                                               | **NÃO BLOQUEANTE**                                 | não altera nenhum valor; afeta só relatórios por tipo (R-CP08-04)                                                                                                                                                                                                     |
| 3   | Custos em serviços por produção                                                            | não existe (custo é sempre por diária do colaborador)                                              | **DECISÃO PENDENTE** (DEC-PROD-01, DEC-CP06-03)    | mesma condição do item 1                                                                                                                                                                                                                                              |
| 4   | Duplicidade de cobrança (mesmo serviço como avulsa e registro antigo, ou adicional manual) | o banco emite; avisos na tela e na confirmação (D-CP06-01, D-CP07-05)                              | **NÃO BLOQUEANTE** (com condição)                  | sem registros antigos em Production e com o cadastro legado encerrado (D7), o caminho automático não ocorre; o restante é adicional manual duplicado, erro humano visível no Fechamento antes de emitir. Passa a **bloqueante** se registros antigos forem importados |
| 5   | Integridade do apontamento no banco (saída antes da entrada, concorrência — AUT-CP05-01)   | as duas telas bloqueiam o D1 e conferem a versão; o banco aceita gravação direta                   | **NÃO BLOQUEANTE**                                 | piloto só com admin pelas telas; operacional real não será criado antes da matriz E2E (CLAUDE.md). Janela de concorrência de milissegundos                                                                                                                            |
| 6   | Conferência atômica da fatura (AUT-CP07-01)                                                | a fatura sai com o valor do banco; a tela avisa depois se diferiu do conferido (D-CP07-03)         | **NÃO BLOQUEANTE**                                 | o valor emitido é o derivado pelo banco (correto pela regra); o risco é emitir algo diferente do que se viu, e a tela avisa. Com um único admin emitindo, a janela é desprezível                                                                                      |
| 7   | Contrato encerrado continua cobrando (DEC-CP02-01, CN-D)                                   | dia depois do fim é lançado e cobrado; o seletor identifica e avisa (D-CP04-04)                    | **DECISÃO PENDENTE**                               | o negócio precisa dizer se o fim encerra a cobrança, só avisa ou é informativo; mitigação: não cadastrar fim de contrato no piloto ou conferir no Fechamento                                                                                                          |
| 8   | Dias abertos na fatura (DEC-CP07-01)                                                       | a confirmação lista dias fechados, abertos e sem apontamento (D4)                                  | **NÃO BLOQUEANTE**                                 | o aviso existe, relido antes de abrir; a decisão é só se deve passar a bloquear                                                                                                                                                                                       |
| 9   | Fatura complementar na mesma competência (DEC-CP07-02)                                     | permitida, com aviso (D-CP07-04)                                                                   | **NÃO BLOQUEANTE**                                 | caso legítimo (lançamento esquecido); não duplica lançamento faturado (imutável)                                                                                                                                                                                      |
| 10a | Feriados em Production                                                                     | lista vazia (PROD-051-01)                                                                          | **BLOQUEANTE PARA O PILOTO**                       | sem o feriado cadastrado o dia é cobrado como dia comum e o tipo do dia congela no lançamento; cadastro exige confirmar município e autorização por ambiente                                                                                                          |
| 10b | Código em Production                                                                       | site `ecd67f2`, sem o #132 e sem o #134 (D5)                                                       | **BLOQUEANTE PARA O PILOTO**                       | as correções dos CP-01 a CP-09 não estão publicadas; exige homologação (CP-12) e autorização de deploy                                                                                                                                                                |
| 10c | Cancelamento ou estorno de fatura (DEC-CP07-03)                                            | não existe caminho na aplicação; faturado é imutável                                               | **DECISÃO PENDENTE**                               | uma fatura emitida por engano trava os lançamentos e só se desfaz fora da fronteira da aplicação; antes do piloto, ao menos um procedimento escrito                                                                                                                   |
| 10d | Prévia da tela × derivação SQL (`billing.ts`)                                              | prévia só mostra; o banco decide; paridade conferida pelos E2E dos CP-05/07/08                     | **NÃO BLOQUEANTE**                                 | o valor gravado e faturado é sempre o do banco                                                                                                                                                                                                                        |
| 10e | CSV do Faturamento sem adicionais e registros antigos (R-CP07-05)                          | rotulado como "Exportar lançamentos" (D-CP08-05)                                                   | **NÃO BLOQUEANTE**                                 | o espelho completo é o Excel do Fechamento                                                                                                                                                                                                                            |
| 10f | Linha nova nasce Presente; presença sem horário = diária inteira (DEC-CP05-03/05)          | avisos "Não gravado" e contagem antes de salvar                                                    | **NÃO BLOQUEANTE**                                 | regra V2 documentada; a tela avisa antes de gravar                                                                                                                                                                                                                    |

**Sequência recomendada (não implementada nesta sessão):**

1. Decidir o escopo do piloto (só diária ou também produção) — DEC-PROD-01/02, DEC-CP06-02.
2. Escrever o procedimento para fatura emitida por engano (DEC-CP07-03) e decidir DEC-CP02-01.
3. Concluir o CP-10 (segurança, integridade e infraestrutura) e o CP-11 (regressão integrada).
4. CP-12: homologação no HML com o responsável, só com autorização nominal de escrita no HML.
5. Cadastrar os feriados do período do piloto, no HML e depois em Production, com autorização
   por ambiente.
6. Publicar em Production o SHA homologado, com autorização nominal ("Autorizo Production").
7. Só se o item 1 incluir produção: desenho, migration, RPC e regra financeira próprios, com
   catálogo (DEC-CP06-01) e custos (DEC-PROD-01), em tarefa autorizada.
8. Endurecimento no banco (AUT-CP05-01, AUT-CP07-01) e conferência de duplicidade (DEC-CP06-04)
   antes de liberar o operador ou de importar registros antigos.

## Resultados

| Verificação                                                  | Resultado                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| spec 98 (RED no `6a23dc4`)                                   | 13 falhas em 17; OP1 RED no build anterior à correção                                                |
| spec 98 (GREEN)                                              | 18/18                                                                                                |
| specs 50, 60, 70, 95 e 97 (afetadas)                         | 79 PASS, 1 PULADO isolado (CL7 depende da spec 20; PASS no completo)                                 |
| `npm run e2e:local`                                          | 223 testes · 222 PASS · 0 FAIL · 1 FALHA CONHECIDA (CN-D) · 0 PULADO · 1577 s · nenhuma rede externa |
| `test:*`                                                     | 80/80 (`test:interface-cp09` 31 asserções, novo; `test:colaboradores-custos` com A4, A5 e A5c)       |
| lint · `tsc` · `check:workflow` · `git diff --check` · build | PASS                                                                                                 |
| SQL local                                                    | 52 suítes PASS                                                                                       |
| travas                                                       | 25/25                                                                                                |
| Docker no fim                                                | 0 containers, 0 volumes                                                                              |

O E2E completo passou de 205 para 223 testes (18 da spec 98); nenhum teste anterior foi removido
ou afrouxado: as specs 50, 60 e 70 passaram a responder ao diálogo da tela em vez do
`window.confirm`, e as 95 e 97 a ler a vírgula decimal (a soma conferida ao centavo é a mesma).

## Riscos residuais

- **R-CP09-01:** as telas de MFA e de redefinição de senha não passaram pela auditoria automática
  de acessibilidade (exigem fator ou token); os fluxos seguem cobertos pela spec 40.
- **R-CP09-02:** a auditoria automática não mede contraste de cor nem ordem de leitura; não houve
  leitor de tela real nesta sessão.
- **R-CP09-03:** "Preço" em Apontamentos é um rótulo sobre um resumo (não um campo); mantido como
  está, sem associação.
- Continuam: R-CP08-04 (lacuna acima), R-CP07-01 a 05, R-CP05-01 a 03.

## Decisões pendentes

Sem novas decisões nesta sessão. Seguem DEC-PROD-01/02, DEC-AV-01/02, DEC-CP06-01 a 05,
DEC-CP07-01 a 03, DEC-CP05-01 a 05, DEC-CP04-01, DEC-CP02-01 a 03; autorizações AUT-CP05-01,
AUT-CP06-01 e AUT-CP07-01.

## Próxima etapa

CP-10 — segurança, integridade e infraestrutura, só com nova autorização. Não iniciado.
