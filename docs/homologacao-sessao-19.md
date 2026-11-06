# Evidências e histórico da homologação — sessão 19

Data: 05/11/2026. SDLC: **Testes**, com correção pontual em Desenvolvimento.
**Checkpoint ativo e estado atual: [HANDOFF](HANDOFF.md).**
Resultados individuais: [livro versionado dos 484 controles](continuidade/controles-sessao-19.json).
As seções abaixo são históricas, válidas apenas para a sessão, código e ambiente
indicados. Não competem com o checkpoint. Arquivos em `/private/tmp` citados nos
relatos são locais; o livro sanitizado é a evidência publicada para retomada.

## Sessão 19G — consolidação e publicação

S19F preservada por hashes. Livro dos 484 controles sanitizado e versionado, sem
novos PASS por inspeção. A correção de jornada foi reexecutada nas 79 suítes, lint e
TypeScript. Commit da correção: `058b3619e5b34f1b13087b718074af6cb1c0ddd9`.
A CI do novo HEAD será conferida após o push; a CI histórica de 55d2153 não o aprova.
Protocolo integrado às instruções dos dois agentes; cabeçalho fora do bloco e um
único prompt copiável. HANDOFF é a fonte principal; índices/históricos apontam a ele.

## Baseline e isolamento

- `main` e `staging` remotas: `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`.
- Checkout de origem preservado, limpo, em `feat/fin-pr-10-calendario-nacional` (`3851a6e`).
- Trabalho: `/private/tmp/bs-session-19`, branch `fix/session-19-dashboard-currency`, HEAD na base acima + alterações não commitadas.
- Preview de staging: GitHub deployment `7584424133`, `success`; Vercel `Ready`, branch `staging`, SHA `38b4349`, URL `bs-logistica-sistema-qbrc4pml6-bslogisticas.vercel.app`. O alias de staging foi aberto no Chrome. Requisições reais observadas no Network apontam ao HML `qbnfcmrxmssnwkhaitgd`, incluindo `timesheet_entries`, `container_services` e `resumo_financeiro_periodo`.
- HML: migration `20261112120000` (045), 50 migrations, confirmadas pela CLI com project ref explícito e `BEGIN TRANSACTION READ ONLY`.
- Limite do deployment: lista da Vercel confirmou o Preview Ready de `staging`, mas a página de detalhes não concluiu o carregamento. A atribuição nominal do alias ao deployment ID continua BLOQUEADA; não foi inferida apenas pelo nome da branch.
- Production: 034 conforme referência do usuário/documentação recente; não consultada nem modificada nesta sessão. Nenhuma migration ou publicação remota foi executada.
- CI da base: [validar](https://github.com/therunnas/bslogistica/actions/runs/42102411878/job/127508357642) e [sql-local](https://github.com/therunnas/bslogistica/actions/runs/42102411878/job/127508357308) em `success` no SHA exato. SQL local não foi repetido: não há alteração de banco e o runner faz reset; o config versionado conserva project_id com referência histórica de Production, sem prova de recursos locais descartáveis desta sessão.

## Totais e limites de contagem

- Baseline: **68/68 suítes PASS**. Regressão final: **69/69 suítes PASS**, incluindo a nova `test:dashboard-moeda` (4 casos).
- **102 cenários direcionados PASS**: 4 SVG/React/Recharts reais com hooks sintéticos + 38 HTTP locais sem sessão + 44 Auth/RLS/MFA no HML + 16 API do app local/HML e exportações reais.
- Duas observações adicionais no navegador: **2 FAIL** no instante da observação (OBS-01: moeda no staging; OBS-02: inicialização do cliente no build diagnóstico Webpack). Total incluindo observações: **104 casos/observações, 102 PASS e 2 FAIL**. A correção local de OBS-01 não muda seu resultado histórico em staging.
- As 69 suítes não são somadas novamente aos 102 cenários; as quatro regressões novas estão nos dois conjuntos. Os loops numéricos de centenas de milhares de asserções não são chamados de jornadas de usuário.
- Falha de produto corrigida localmente: **1**, abrangendo rótulo da pizza e eixo monetário. Sem PR, commit, push, merge ou deploy.
- Lint, TypeScript, Prettier dos arquivos de código alterados e diff check: PASS. `npm ci --offline` usou o lockfile existente, sem nova dependência.
- `npm run build` padrão: **BLOQUEADO** por `binding to a port / Operation not permitted` do Turbopack, inclusive após escalonamento. `npm run build -- --webpack`: compilação PASS, **frontend reprovado em execução** (OBS-02). Os testes HTTP não validam hidratação.
- O backend do candidato Webpack foi exercitado de fato contra o HML com cookies reais das identidades S19. Isso não equivale a Preview da correção nem a navegação autenticada em staging.

## Defeitos e correção

**S19-01 / OBS-01 — formatação monetária.** Reprodução: abrir o Dashboard de staging no recorte de novembro exibido; a pizza mostra `6846.89` e o eixo financeiro mostra ticks sem moeda. Causa: `label` booleano do Recharts usa o valor cru; o eixo não tinha `tickFormatter`. Mudança mínima: rótulo por `brl(Number(value))`; eixo financeiro com `tickFormatter={brl}` e largura 110. Os tooltips já usavam `brl`; diárias continuam quantidades. Busca limitada em `src` encontrou os gráficos concretos somente no Dashboard; Relatórios usa outras apresentações e não outro gráfico Recharts. O wrapper genérico de gráficos não foi alterado.

RED observado: três casos falharam por texto numérico cru/formatter ausente; GREEN: quatro casos passaram, com render dos SVGs do Recharts. Os valores fixo/avulso continuam numéricos e dados vazios continuam sem pizza. Nenhum cálculo, dado persistido, migration, regra comercial ou proteção mudou. A regressão está no npm e na CI. **Não foi publicado em staging.**

**OBS-02 — cliente do build diagnóstico Webpack.** O `/login` local retorna HTML válido, mas, após executar JavaScript no Chrome, mostra `Application error`. Console: variáveis públicas do Supabase ausentes. O bundle real lê `process.env` do navegador e não contém os placeholders públicos informados no build. Causa observada limitada ao artefato Webpack; não se atribuiu esse comportamento ao staging Turbopack. Nenhum relaxamento de isolamento/CSP foi aplicado para contornar o erro. Sem correção, E2E visual local permanece bloqueado.

## Matriz por módulo

PASS vale somente para a funcionalidade e ambiente indicados; BLOQUEADO não significa ausência de defeito. Não há aprovação de CRUD ou de uma tela pelo seu status HTTP.

| Módulo/funcionalidade    | Teste executado                                                  | Resultado                                     | Evidência                                                         | Defeito                                 | Correção/PR                                      | Risco residual                                                                             |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Login/logout             | Senha válida/inválida e refresh; formulário HTTP                 | PASS API; BLOQUEADO UI                        | HML-01–05,44; HTTP-28; OBS-02                                     | Falha do bundle Webpack local           | Sem correção de Auth nesta branch                | Login/logout na interface de staging sem evidência S19                                     |
| MFA                      | TOTP inválido/válido, AAL1 negado e AAL2 permitido               | PASS Auth/RLS; BLOQUEADO UI                   | HML-39–43; HTTP-16                                                | Nenhum no escopo executado              | Não aplicável                                    | Fluxo visual de MFA e recuperação com TOTP no staging pendentes                            |
| Recuperação              | GET, cookie, repetição e destino; prova ausente                  | PASS etapas HTTP; BLOQUEADO fluxo completo    | HTTP-17–18,29–36; suítes recuperacao/prova/troca                  | Nenhum nas etapas HTTP                  | Não aplicável                                    | Envio/template/expiração remotos e troca final não exercitados                             |
| Usuários                 | Papéis próprios e sessão sem papel; proteção da rota             | PASS segurança; BLOQUEADO administração UI    | HML-28–31; HTTP-15; test:admin-usuarios/tela-usuarios             | Nenhum no escopo executado              | Não aplicável                                    | Convite, alteração de papel, último admin e auditoria na UI não exercitados S19            |
| Clientes                 | Dois clientes sintéticos lidos pelo admin; operador sem acesso   | PASS leitura/RLS; BLOQUEADO CRUD UI           | HML-06,17,32–35; HTTP-03                                          | Nenhum no escopo executado              | Não aplicável                                    | Formulários, busca, paginação, recarga e responsividade pendentes                          |
| Contratos                | Operador/sem papel sem leitura; domínio automatizado             | PASS negativa/domínio; BLOQUEADO UI           | HML-07,18; test:integridade-contratos/periodo-contratual          | Nenhum no escopo executado              | Não aplicável                                    | Cadastro/edição de contrato por formulário e filtros pendentes                             |
| Funções/turnos           | Turno de operação alheia recusado; contratos de função/turno     | PASS negativa/domínio; BLOQUEADO UI           | HML-10,21,36; test:funcoes-turno/snapshots-tarifas                | Nenhum novo comprovado                  | Não aplicável                                    | Cadastro, vigência e turno pela UI não exercitados S19                                     |
| Colaboradores            | Tabelas negadas ao operador e sem papel                          | PASS negativas; BLOQUEADO CRUD UI             | HML-08,19; HTTP-04                                                | Nenhum no escopo executado              | Não aplicável                                    | Validações cadastrais, filtros, paginação e persistência após recarga pendentes            |
| Operações                | Atribuição só de A1; B1 oculta; sem campos financeiros           | PASS RPC/RLS; BLOQUEADO UI                    | HML-09,20,34–37; HTTP-13                                          | Nenhum no escopo executado              | Não aplicável                                    | Formulários, equipe/turnos, navegação e filtros pendentes                                  |
| Apontamentos             | Leitura direta negada; domínio, rascunho e cálculos locais       | PASS negativas/suítes; BLOQUEADO escrita UI   | HML-11–12,22–23; HTTP-02; suítes apontamentos-*                   | Nenhum no escopo executado              | Não aplicável                                    | Presença/falta/substituição, validação e recarga na UI não repetidos S19                   |
| Adicionais               | Leitura proibida por papel; adicionais do recorte na API         | PASS RLS/recorte; BLOQUEADO CRUD UI           | HML-15,26; APP-09; test:regras-bs                                 | Nenhum no escopo executado              | Não aplicável                                    | Registro/cancelamento autorizado via formulário não exercitado S19                         |
| Containers               | RLS; custo de 63001 centavos na referência real                  | PASS leitura/custo; BLOQUEADO fluxos UI       | HML-16,27,38; APP-09; HTTP-06–08; suítes container-*              | Nenhum no escopo executado              | Não aplicável                                    | Nove fluxos UI recentes permanecem evidência histórica, não execução em staging S19        |
| Calendário/feriados      | UF inválida e perfis proibidos; domínio territorial              | PASS validação/negativas; BLOQUEADO UI/IBGE   | HTTP-20; APP-04,08,13; test:calendario-territorial                | Nenhum no escopo executado              | Não aplicável                                    | Cobertura, cadastro e consulta oficial bem-sucedida via UI não exercitados                 |
| Dashboard                | Rótulos SVG, eixo, tooltips e quantidades; sintoma no staging    | FAIL staging; PASS regressão local            | OBS-01; SVG-01–04; HTTP-01                                        | S19-01: moeda sem pt-BR no gráfico/eixo | fix/session-19-dashboard-currency; sem PR/deploy | Correção sem confirmação visual em staging; mobile não comprovado                          |
| Fechamento               | API real, custo composto, conciliação e filtros inválidos        | PASS API; BLOQUEADO UI                        | APP-09–12; HTTP-10,21; suítes fechamento-*                        | Nenhum no recorte executado             | Não aplicável                                    | Estados, navegação, recarga e todos os períodos na UI pendentes                            |
| Faturamento              | Fatura emitida, itens e receita do resumo conciliados            | PASS leitura; BLOQUEADO emissão/UI            | HML-38; HTTP-09; test:margem-containers                           | Nenhum no recorte executado             | Não aplicável                                    | Sem emissão nem tentativa de mudar lastro existente nesta sessão                           |
| Relatórios               | RLS de fontes e domínio financeiro automatizado                  | PASS escopo local; BLOQUEADO UI               | HTTP-14; test:custo-containers/ledger-estados                     | Nenhum novo comprovado                  | Não aplicável                                    | Conciliação visual, filtros, paginação e exportação pela UI pendentes                      |
| Exportações XLSX         | Dois downloads reais, XML/valores/filtros, SUBTOTAL e assinatura | PASS API/XML; BLOQUEADO interação UI          | APP-14–16; HTTP-22–25; suítes fechamento-xlsx*                    | Nenhum nos arquivos inspecionados       | Não aplicável                                    | Excel nativo e filtros interativos não repetidos S19; layouts históricos preservados       |
| Configurações            | Guard sem sessão e decisões de conta automatizadas               | PASS negativa/suítes; BLOQUEADO UI            | HTTP-05; test:configuracoes/mfa-opcional                          | Nenhum novo comprovado                  | Não aplicável                                    | Preferências, mensagens e operações de conta na UI pendentes                               |
| Permissões               | 11 tabelas negadas por perfil, RPC atribuída, APIs e MFA         | PASS cenários executados; BLOQUEADO matriz UI | HML-06–43; APP-01–08; HTTP-01–27                                  | Nenhum nos cenários executados          | Não aplicável                                    | Admin é global; não se afirmou contrato de admin por tenant; tentativas UI ainda pendentes |
| Implantação de vigências | Rota protegida e gates locais de ativação/reversão               | PASS negativas/suítes; BLOQUEADO UI           | HTTP-11; test:implantacao-vigencias/ativacao-motor/reversao-motor | Nenhum novo comprovado                  | Não aplicável                                    | Nenhuma flag/regra foi ativada; fluxo crítico visual pendente                              |

## Cobertura financeira

O caso **Cliente A, 01/10–15/10/2026** foi conferido por JWT real de admin sintético (HML-38), incluindo fatura emitida, soma dos itens e RPC de resumo; depois pela API real `/api/fechamento` (APP-09):

- Receita: **378251 centavos** (R$ 3.782,51).
- Custo: **115163 de apontamentos + 63001 de Containers = 178164 centavos** (R$ 1.781,64).
- Resultado: **200087 centavos** (R$ 2.000,87).
- Todas as comparações retornadas em `conciliacao` conferiram. Os dois XLSX foram gerados pela API com assinatura do recorte real. O interno contém receita/custo/resultado numéricos; o do cliente contém a receita, filtros e `SUBTOTAL(109,…)`, sem os rótulos financeiros internos inspecionados. Assinatura divergente retornou 409 sem arquivo.

Diária por função/turno, HE 15/45, sábado, domingo/feriado, adicional e imutabilidade têm suítes locais executadas e evidência recente na [matriz FIN-PR-13](financeiro/homologacao-fin-pr-13.md). A sessão 19 **não repetiu escritas financeiras** nem ligou resolução comercial para recriar essas provas. Isso não comprova todas as combinações na UI do staging. Nenhum registro existente foi alterado para obter a referência esperada.

## Segurança e dados sintéticos

Somente contas `s19-…@e2e-sintetico.invalid` foram usadas nos testes Auth/RLS. As chaves do HML, senhas, tokens e segredo TOTP ficaram em memória, sem arquivo ou saída. Foram criadas quatro contas/perfis, quatro atribuições de papel, uma atribuição do novo operador à operação sintética A1 e um fator TOTP na nova conta admin. Nenhum convite/e-mail foi enviado e nenhum usuário real foi alterado. Os registros foram preservados; limpeza futura exige escopo específico.

| Conta sintética S19 | ID para rastreio                     |
| ------------------- | ------------------------------------ |
| admin               | 971bb4a4-19e0-43fb-9e7b-e0fd60d8a43a |
| operator            | 5fec543b-c2cf-45ee-a7c5-940aa7505798 |
| no-role             | 8d6e7d6a-55cd-4e1e-ac9a-8a7a39dc3e49 |
| dual                | eb819068-4c5f-4624-b511-7fdd040a32f0 |

A RLS/ACL foi exercitada pela API com JWT reais: operador e sem papel sem linhas em onze tabelas; papéis próprios; operador atribuído só a A1 e sem dados financeiros nas respostas testadas; B1 recusada; conta com fator verificado barrada em AAL1 e liberada após TOTP. A aplicação também recusou os perfis proibidos nas quatro APIs. Admin é global por desenho: não se inventou isolamento de admin por cliente.

CSP por request, nonce no HTML, `nosniff`, `DENY`, Permissions-Policy, cookies pendentes HttpOnly/Secure/Lax e destinos sem query de token foram conferidos no servidor local. Ausência de secrets no sistema inteiro, histórico Git ou todos os bundles remotos **não está comprovada** por esses testes. Nenhuma credencial de Production foi usada.

## Sessão 19B/19C — jornada operacional pela interface (local × HML)

Ambiente: build Webpack do candidato em `localhost:3202` com a configuração pública do HML `qbnfcmrxmssnwkhaitgd`. O bundle contém a chave pública e não contém a chave administrativa. Sessão sintética S19B (admin `969d8352…`, operador `4ba5e1a7…`) emitida pela ponte local do harness. Production, migrations, merge e deploy não foram tocados. Casos detalhados: `s19b/ui-cases.json` (11) e `s19c/ui-cases.json` (50).

**Harness (fora do repositório).** A ponte recusava a automação com 403. O log de procedência mostrou `Sec-Fetch-Site: cross-site`, sem `Origin` nem `Referer`, porque a navegação parte da extensão. A guarda original continua valendo para navegações comuns. Foi acrescentado um **armamento de uso único**: um processo local lê um segredo de um arquivo `0600`, que nunca passa pelo navegador nem pelo log, e libera por 60 s uma única emissão para uma navegação cross-site de documento sem `Origin` nem `Referer`. Negativos com PASS: segredo errado ou ausente, armamento com cabeçalhos de navegador, Host inválido, cross-site com Referer, reuso do armamento, bind só em `127.0.0.1`, rota protegida sem cookie (307). O cookie da ponte vale 900 s e foi renovado pelo armamento ao longo da sessão. Login, MFA, proxy e políticas do produto não mudaram.

| Jornada                       | Resultado              | Evidência principal                                                                                                                                                                           |
| ----------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente → contrato → vigência | PASS (19B)             | S19B-UI-003…009, DB-001                                                                                                                                                                       |
| Operação fixa + recarga       | PASS                   | S19B-UI-010, S19C-UI-001                                                                                                                                                                      |
| Localidade (SC → municípios)  | PASS; Itajaí BLOQUEADO | 295 municípios; Navegantes 4211306 desde 05/11; sobreposição recusada. Itajaí já está no catálogo como `E2E-S11 Itajaí (sintético)` e o catálogo append-only recusa corretamente (UI-002…006) |
| Operador atribuído            | PASS                   | UI-008/009; "responsável" não existe no produto (UI-010 NÃO TESTADO)                                                                                                                          |
| Colaboradores                 | PASS                   | 2 criados, editados e reconciliados no HML (UI-011…015, DB-002)                                                                                                                               |
| Turno e alocação              | PASS                   | UI-017…019                                                                                                                                                                                    |
| Avulsa e Containers           | PASS                   | Avulsa R$ 300,00; serviço 2 containers, R$ 500,00 / custo R$ 170,00 (UI-020/021)                                                                                                              |
| Apontamentos                  | PASS                   | Entrada = saída bloqueada; HE 1h30 = R$ 67,50; tolerância 10 min; falta zerada; preview = trigger SQL (UI-023…026, DB-003)                                                                    |
| Fechamento + exportações      | PASS                   | Receita R$ 1.287,50; custo R$ 678,25; resultado R$ 609,25; 6 parcelas "Confere"; XLSX interno/cliente e CSV inspecionados (UI-029/030)                                                        |
| Faturamento                   | PASS                   | Adicional criado e cancelado com histórico; fatura `248b1fc0…` R$ 1.287,50 com itens 720 + 67,50 + 500; imutabilidade na UI (UI-031…033, DB-004)                                              |
| Relatórios / Dashboard        | PASS após correção     | S19C-DEF-005 corrigido: margem 01–15/10 = R$ 2.000,87 igual à fatura (REG-005); linhas e CSV conferem (UI-034…037)                                                                            |
| Permissões operador           | PASS                   | Só a operação atribuída, sem R$; rotas admin restritas; `/api/fechamento` 403 (PERM-001/002)                                                                                                  |
| Sábado/feriado/resolução      | NÃO TESTADO            | O motor comercial está desligado no HML; ligá-lo altera regra comercial (UI-027)                                                                                                              |
| Apontamento da avulsa         | NÃO TESTADO            | Exige mover a equipe da operação fixa (UI-028)                                                                                                                                                |

**Defeitos.** Os quatro corrigidos têm RED/GREEN, suíte no npm e na CI e confirmação visual após rebuild (S19C-REG-001…004). Nenhum foi commitado.

- **S19C-DEF-001**: "Criado em" e "Último login" em Usuários exibidos em UTC (`dateBR` cortava o ISO). Correção: `instanteBR` no fuso de São Paulo; `test:usuarios-data-instante`.
- **S19C-DEF-002**: abrir um diálogo pelo cabeçalho deslocava a página 224 px, porque o invólucro `overflow-hidden` do brilho era rolável. Correção: `overflow-clip`; `test:shell-sem-rolagem`.
- **S19C-DEF-003**: o histórico de vigências impunha a largura da tabela ao diálogo de edição e cortava os campos. Correção: `min-w-0` na seção; `test:vigencias-largura`.
- **S19C-DEF-004**: Containers exibiam datas ISO e o instante da auditoria em UTC. Correção: `dateBR` e `instanteDataHoraBR`; `test:containers-datas`.
- **S19C-DEF-005 (corrigido; critério aprovado pelo responsável em 05/11/2026)**: a margem de Relatórios e Dashboard somava o custo de Containers pela data de **execução** (`src/lib/custo-containers.ts`, PR #104), enquanto a receita (`resumo_financeiro_periodo`, migration 038) soma o adicional pela **competência**. Em 01–15/10, Relatórios mostrava margem de R$ 2.300,88 contra R$ 2.000,87 da fatura e do Fechamento; a diferença de R$ 300,01 é o serviço executado em 16/10 e cobrado na 1ª quinzena. **Regra aprovada:** o custo acompanha a competência de cobrança do adicional (`coalesce(billing_period_*, period_*)` inteira no período, serviço e adicional não cancelados). A data de execução fica preservada e só vale como fallback se o adicional não vier na leitura. A leitura (`lerServicosAtivos`) embute `billing_additionals(...)` e não recorta mais por `executed_on`. A suíte `testar-custo-containers` foi reescrita, com a mudança de critério documentada no cabeçalho: RED com 7 falhas, GREEN com 17/17. Ela cobre a regressão 16/10 × 01–15/10, competência parcial, legado pré-038, cancelamentos de serviço e de adicional, múltiplos clientes (B mensal), equivalência com `somarCustoDosAdicionais` (Fechamento e Faturamento) em três recortes, ausência de duplicidade com participantes e o schema 034. Após o rebuild, Relatórios e Dashboard de 01–15/10 mostram custo R$ 1.781,64 e **margem R$ 2.000,87**, iguais à fatura (S19C-REG-005). Sem migration e sem alteração de fatura, dado persistido ou regra do banco.

**Observações (sem correção).** OBS-S19C-01: fim < início bloqueia sem mensagem. 02/03: os 503 do monitor de rede para HEAD são artefato da ferramenta. 04: Nova operação abre com um cliente pré-selecionado. 05: avulsa sem valor e sem data é aceita. 06: validação de Containers aparece no topo, fora da área visível. 07: o cabeçalho mostra "Painel interno" nas rotas de Containers. 08: Apontamentos não preserva a seleção na recarga. 09: data ISO em "Equipe do dia". **10: a emissão de fatura é irreversível e acontece em um clique, sem confirmação (risco alto).** 11: hora extra aparece como "1,5 h" na lista de faturas e "1h30" no restante. 12: no dia faturado, o KPI ainda se chama "A faturar". 13: o CSV de Relatórios usa ponto decimal com `;`.

**Controles adicionais (sem repetir jornadas aprovadas).**

- Clientes: a exclusão de cliente e de contrato com histórico é recusada com mensagem clara. A edição de contrato em uso trava cliente e valores. Os feriados (novo e aposentar) e a diária individual mostram validações, e Cancelar/Voltar não gravam nada (UI-038…041).
- Usuários: convite vazio é bloqueado e e-mail inválido é recusado pelo servidor, sem envio. Os diálogos de revogar papel e acesso funcionam com Cancelar. O ciclo completo também foi exercitado: revogar acesso, login negado pelo GoTrue (403), reativar e reatribuir, voltando ao estado inicial (UI-042…044).
- OBS-S19C-14 (risco): excluir cliente ou contrato dispara em um clique, sem confirmação.

**Cobertura por controle.** `s19c/controles-status.json` (gerado por `s19c/mapear_controles.py`) liga cada controle do inventário a casos que o acionaram na UI. Resultado: **210 PASS e 274 NÃO TESTADO, de 484**. O mapeamento é conservador: shell, Dashboard e operacional só contam os controles realmente usados. A cobertura é zero em vigências (34), implantação de vigências (16), configurações e MFA (20), login, recuperação e auth (19) e acesso compartilhado (5). Há parciais em calendário territorial (23 pendentes), apontamentos (18), fechamento (16), colaboradores (15), containers (20) e clientes (33).

**Verificação final.**

- **Antes da correção do DEF-005:** 74/74 suítes PASS (`s19c/final-suites-2/summary.tsv`). A pasta `final-suites/` é uma execução inválida, com exit 127 porque o `timeout` não existe no macOS.
- **Depois da correção:** 74/74 suítes PASS (`s19c/final-suites-3/summary.tsv`).
- Lint, `tsc --noEmit`, Prettier dos arquivos alterados e `git diff --check`: PASS.
- Build Webpack com a configuração do HML: PASS, nos rebuilds 4 e 5 do harness.
- **Build padrão (Turbopack) da CI, com placeholders: BLOQUEADO** neste ambiente, com "binding to a port / Operation not permitted (os error 1)" (`s19c/build-padrao*.log`), inclusive fora do sandbox do shell. É a mesma restrição da sessão 19 e não está relacionada ao código. O passo `Build` da CI no GitHub continua sendo o gate.

**Dados sintéticos criados (HML, preservados).** Termos de localidade `c56ae55a…` (fixa) e o da avulsa; catálogo `4211306`; atribuição do operador; colaboradores `52b4d76b…` e `8475c95f…`; turno E2E-S19B Dia 08-17; operação avulsa `bc2d9ecf…`; container `f86d5faf…`; adicional de R$ 50,00 cancelado; 4 lançamentos em 05–06/11; fatura `248b1fc0…`. Nenhum dado de sessão anterior foi alterado.

## Sessão 19D — confirmações irreversíveis e prioridade 1

Ambiente: igual ao da 19C, com rebuilds Webpack 7 e 8 do harness. Casos S19D-* em `s19c/ui-cases.json`, que agora tem 71 casos.

**Defeitos corrigidos.** Ambos têm RED/GREEN, suíte no npm e na CI e confirmação na UI. Nenhum foi commitado.

- **S19D-DEF-001**: emitir fatura e excluir cliente/contrato disparavam em um clique. Correção: `ConfirmarAcaoIrreversivel` (AlertDialog com título, descrição, Cancelar e Confirmar). Faturamento e Clientes só chamam a mutação a partir da confirmação, e a trava existente do botão de fatura continua. Suíte `test:confirmacao-irreversivel`: RED 4/4, GREEN 4/4. `testar-clientes-validacao` passou a reconhecer o módulo novo. Na UI:
  - Cancelar e Esc não geram DELETE nem RPC.
  - Confirmar em cliente/contrato com histórico gera DELETE 403 com a mensagem de negócio de sempre.
  - Confirmar a fatura emitiu a S19B 16–30/11 (R$ 10,00, adicional sintético S19D-ADI-001) após o diálogo informar cliente, período, total e irreversibilidade (S19D-UI-001…003).
- **S19D-DEF-002**: ativar o 2FA com código errado mostrava "Invalid TOTP code entered", texto cru do Supabase. A desativação já traduzia. Correção: `mensagemDeCodigoInvalido` também na ativação; `test:configuracoes-ativacao-codigo` RED 2/2, GREEN 2/2. Na UI: "Código inválido. Confira o aplicativo autenticador e tente novamente." (S19D-UI-005, REG-001).

**Prioridade 1.**

- **Segurança/2FA:** estado, QR/chave (não registrados), filtro numérico, 6 dígitos, código recusado, Cancelar e recarga. O fator pendente não bloqueia o acesso (UI-004).
- **Vigências:**
  - Nova vigência de custo com validações (fim ≤ início, mais de 2 casas decimais).
  - Registro futuro de R$ 155,00 desde 16/11, encerrando a anterior em 16/11.
  - Aposentar: Cancelar, e recusa da versão usada por apontamentos (UI-006/007).
- **Implantação de vigências:** somente leitura. O motor está ligado desde 24/10 e desligar está desabilitado por configuração (UI-008). **Correção de premissa do UI-027:** o motor por vigência está ligado no HML; desligada está a resolução por função/período.
- **Logout:** volta para /login; rotas protegidas redirecionam; o Voltar do navegador não expõe dados (UI-009).
- **Login, recuperação e rotas:** validações sem credencial; /redefinir-senha sem prova → /esqueci-senha; /mfa sem sessão → /login (UI-010/011).
- **BLOQUEADO por política do agente:**
  - login com senha;
  - TOTP válido (ativar/desativar 2FA, /mfa, recuperação com MFA);
  - envio de e-mail de recuperação e redefinição com token;
  - ligar/desligar o motor.

  Esses fluxos exigiriam digitar senha ou código de autenticação enviados ao HML (host externo), disparar e-mail ou reverter regra global. Há evidência equivalente por API/HTTP na S19 (HML-01–05, 39–43; HTTP-16–18, 28–36).

**Prioridade 2 (amostra adicional).** Fechamento: 2ª quinzena; período personalizado inválido e válido; detalhamento diário. Em 05–06/11 o custo é R$ 508,25 sem Container, o mesmo critério de Relatórios após o DEF-005, o que confirma a equivalência entre as telas (UI-012).

**Cobertura por controle (S19D).** `s19c/controles-status.json`, regenerado por `mapear_controles.py`, que agora inclui `motivo_bloqueio`: **248 PASS, 0 FAIL, 39 BLOQUEADO e 197 NÃO TESTADO, de 484**. Rótulos duplicados no mesmo módulo (p.ex. "Cancelar" e "Motivo") são casados por texto e podem marcar como PASS um controle-irmão não acionado; a contagem é aproximada para cima nesses casos.

**Verificação S19D.** `s19c/final-suites-4/summary.tsv`: **76/76 suítes PASS**. Lint, `tsc --noEmit`, `git diff --check` e Prettier de todos os arquivos alterados ou novos: PASS. Webpack com a configuração do HML: PASS (rebuild 8). Turbopack: segue BLOQUEADO no ambiente local, sem evidência nova.

**Dados sintéticos adicionais (HML):**

- vigência de custo `E2E-S19B Colab 1` desde 16/11 (R$ 155,00), com a anterior encerrada em 16/11;
- adicional `S19D-ADI-001` (R$ 10,00);
- fatura S19B 16–30/11 (R$ 10,00);
- fator TOTP **não verificado** pendente na conta `s19b-admin` (não afeta o acesso);
- tentativas de exclusão recusadas pelo banco.

## Sessão 19E — matriz por evidência explícita e regras aprovadas

**Matriz corrigida.** A associação por rótulo foi substituída por um livro de evidências explícito: `s19e/livro_evidencias.py` gera `s19e/controles-status.json`. Cada controle entra pelo `id` estável do inventário (arquivo:linha + rótulo), com caso, ação observada e resultado próprios, sem herdar resultado de controle-irmão; uma ambiguidade aborta a geração. Controles apenas vistos, ou com valor padrão não alterado, ficam NÃO TESTADOS. Recontagem antes da S19E: 189 PASS (eram 248). **Depois da S19E: 233 PASS, 1 FAIL, 40 BLOQUEADO e 210 NÃO TESTADO, de 484.**

**Regras aprovadas, implementadas com RED/GREEN e confirmadas na UI:**

- **CSV de Relatórios (S19E-DEF-001):** `;`, decimal `,` a partir de centavos inteiros, data dd/mm/aaaa, UTF-8 com BOM e acentos preservados (`src/lib/relatorios-csv.ts`; `test:relatorios-csv` exporta e reimporta). Arquivo real `s19e/exports/relatorio-s19e.csv`.
- **Operação avulsa:**
  - data obrigatória;
  - sem contrato, o valor é obrigatório e não negativo;
  - zero só com justificativa em Observações;
  - com contrato ou valor travado pela vigência, o valor não é exigido.

  Fica em `src/lib/operacao-avulsa.ts` e `test:operacao-avulsa`. Impacto legado no HML: 1 avulsa, já com data e valor.

- **Exclusão:** cliente sem histórico excluído com confirmação (DELETE 204, ausente no HML). Com histórico, o banco continua recusando. A confirmação foi estendida a **colaborador, operação e turno (S19E-DEF-003)**; Confirmar mantém as recusas do banco (403 com mensagem).
- **Período do contrato (S19E-DEF-002):** "Vigente até" anterior ou igual a "Vigente de" era gravado (HML: `E2E-S19E Contrato Teste`, 06/11 → 01/11). Agora há alerta e o Salvar fica bloqueado (`test:contrato-periodo`).

**Aberto.**

- **FAIL:** jornada 0 no contrato é trocada por 8 sem aviso (`Number(...) || 8`).
- **BLOQUEADO até decisão de regra:** fator de hora extra 0,5 é aceito e gravado.
- O formulário de contrato mostra os erros um por vez, só no envio.

**Competência já faturada.** Rotas que criam ou alteram lançamentos:

1. upsert direto de `timesheet_entries` no Apontamento do admin;
2. RPC `salvar_apontamento_admin`;
3. RPC `salvar_apontamento_operacional`;
4. registro de adicional com competência já faturada.

Hoje o banco só imobiliza a linha **faturada**. Uma linha nova ou não faturada (p.ex. falta → presente) numa competência já faturada é aceita e fica "a faturar" sem fatura possível, porque `gerar_fatura` recusa a repetição. **Proposta (requer migration e autorização):** restrição no banco (trigger em `timesheet_entries`/`billing_additionals` e checagem nas RPCs) que recuse INSERT/UPDATE que altere valor quando houver fatura do cliente cobrindo a data/competência, com mensagem orientando a fatura complementar. Não foi implementada.

**CI e Preview.** PR Draft #106, HEAD `95eec9e`: `validar` PASS (lint, TypeScript, 79 suítes e build **Turbopack** com placeholders, "Compiled successfully in 11.7s"), `sql-local` PASS e Vercel Preview PASS. O Preview (atrás do SSO da Vercel) aponta **somente** para o HML: os scripts e a CSP `connect-src` não citam outro projeto, e a rota protegida sem sessão redireciona para /login. Os testes autenticados no Preview estão BLOQUEADOS porque exigem login com senha. Divergência documental: o CLAUDE.md afirma que o Preview não tem `NEXT_PUBLIC_*`, mas o Preview deste PR está configurado para o HML.

**Containers (S19E).** Filtros da lista e variações do novo serviço: rateio "Total distribuído" com soma exata, competência específica, Voltar e corrigir, remover participante e abandono sem registro (UI-010/011). OBS-S19E-01: o link "Novo serviço" da lista reabre a tela "Serviço registrado" do registro anterior.

**Autenticação.** Login com senha, TOTP real, envio de e-mail de recuperação e redefinição continuam **BLOQUEADOS**: não há mecanismo de credencial de teste que não passe pelo agente nem caixa de e-mail isolada no HML. O fator TOTP pendente da conta `s19b-admin` não tem caminho legítimo de limpeza pela UI (Cancelar não remove; um novo cadastro o substitui), por isso foi mantido e documentado.

## Sessão 19F — controles restantes e jornada zero (06/11/2026)

SDLC: **Testes**, com correção pontual em Desenvolvimento. Retomada no worktree
`/private/tmp/bs-session-19`, branch `fix/session-19-dashboard-currency`, HEAD
`55d2153fe49eebf71f4f1d26be14b99479a07bba`, limpo antes das alterações S19F e igual
ao PR Draft #106. O diretório inicial `/private/tmp/bs-fin-pr-09` estava em outra
branch com exclusões locais; foi preservado. HANDOFF anterior descrevia a S19
inicial: reconciliado com Git/PR e os checkpoints explícitos S19C–S19E.

**Matriz individual.** Baseline 233/1/40/210 → **283 PASS / 0 FAIL / 64 BLOQUEADO /
137 NÃO TESTADO**, total 484. São 49 novos PASS, a falha de jornada convertida em
PASS e 24 controles antes pendentes classificados BLOQUEADOS. Livro S19E intacto;
74 entradas próprias por ID em `s19f/ui-cases.json`, refletidas em
`s19f/controles-status.json`, com ação, resultado, código e ambiente individuais.
O `s19f/checkpoint-s19f.json` contém contagens por módulo e SHA-256 dos artefatos.
Não há aprovação por herança de rótulo ou aprovação de módulo inteiro.

**S19F-DEF-001 — jornada contratual zero.** A causa era o fallback
`Number(contractForm.shift_hours) || 8`. A correção recusa valor não finito ou
menor/igual a zero antes de enviar condição financeira; mostra alerta e desabilita
Salvar. O payload envia o valor válido sem fallback. Edição de metadados com
condição financeira travada continua sem reenviar esses campos. Nenhum contrato
ou snapshot legado foi regravado; fator HE inferior a 1 não foi alterado.

RED: 8 falhas nos handlers reais; GREEN: 21/21 casos, com motor ligado/desligado,
zero/negativo/NaN/Infinity, valores 4/7,5/8 preservados e metadados legados.
UI S19F-UI-002: zero mostra “Informe uma jornada da diária maior que zero.” e
bloqueia Salvar;8 remove alerta e libera. Cadastro abandonado sem gravar.
Revisão independente dos dois arquivos: sem findings, 21 testes repetidos PASS.

**Cobertura nova UI local × HML.** Casos S19F-UI-001…050 no livro individual:
lista/abas de contratos e clientes, telefone sintético persistido, opções iniciais
de sábado/feriado/arredondamento/fechamento; tarifas e diária individual futuras,
seu cancelamento e persistência; X dos diálogos; edição de observação e seleção
contratual de operação; nova vigência de valor acordado, validações, fechamento
exclusive, motivo e abandono de aposentadoria/nova versão; seis campos da vigência
contratual com erros e valores válidos. Parâmetros contratuais desta última prova
não foram registrados. A guia de teste criada pela S19F foi fechada sem submissão.

**Dados sintéticos adicionados/alterados nesta sessão, preservados:**

- cliente S19B: telefone `00000000000`;
- contrato S19B: tarifa Diurno da função E2E-S11, R$ 300,00 desde 07/11;
- contrato S19B: diária individual do Colab 1, R$ 310,00 desde 07/11;
- operação fixa S19B: observação identificando a prova S19F;
- avulsa S19B: valor acordado futuro R$ 320,00 de 07/11 a 08/11 (exclusive), versão
  anterior R$ 300,00 encerrada em 07/11. Não houve aposentadoria nem exclusão.

Resolução comercial permaneceu desligada. Nenhuma regra global, migration, RLS,
grant, política, fatura ou fechamento foi alterado.

**Limites identificados.** Ligar resolução comercial (1 controle) é vedado S19F.
Os23 controles do formulário/lista de feriados e cobertura territorial
(`calendario-territorial.tsx:194–473`) não são oferecidos no regime legado da UI;
o componente só os renderiza com regime territorial. Ativar esse regime mudaria
regra global. Esses 24 controles têm motivo individual de BLOQUEADO, nunca PASS.
As localidades operacionais são independentes e seus 5 controles restantes não
foram aprovados por esse diagnóstico.

A recusa `permission denied for table operations` ao editar observação foi
registrada durante cookie expirado do harness (900s). Leitura confirmou papel
admin, grants e ausência da gravação naquele instante. Após renovar a sessão,
salvamento e reabertura em guia limpa confirmaram a observação persistida.
Diagnóstico em `s19f/operations-session-diagnosis.json`; sem defeito de produto
confirmado nem alteração de permissões.

**Ambiente e validação.** HML revalidado por SELECT em transação READ ONLY:
50 migrations, head 045 (`20261112120000`). Harness S19B reiniciado com identidades
existentes, sem criar conta; bundle reconstruído com HML público e sem chave
administrativa no cliente. 79/79 suítes, lint, TypeScript e build Webpack PASS;
workflow, Prettier e diff check conferidos no fechamento. SQL local destrutivo não
repetido, sem alteração de banco. CI remota no SHA 55d2153: `validar` e `sql-local`
PASS, run 42207509552; Vercel/CodeRabbit success. Isso não é CI do working tree S19F.
Preview autenticado e seu runtime corrente não foram revalidados nesta sessão;
não transferir a evidência local para Preview. Production não acessada.

**Bloqueio de execução e retomada.** O host de navegador retornou
`The browser access host is unavailable`; fallback nativo apresentou
`noWindowsAvailable`, estados atrasados e ações sem confirmação confiável.
Os 137 restantes ficaram NÃO TESTADOS. Restabelecer a automação e a sessão sintética,
começar pelos seletores da nova vigência contratual e pelo valor-hora de HE paga,
e seguir a fila do checkpoint. Continuidade em [Estado atual](continuidade/ESTADO_ATUAL.md),
[Protocolo](continuidade/PROTOCOLO_DE_TRABALHO.md) e [HANDOFF](HANDOFF.md).

## Pendências e próxima execução

1. Restabelecer automação confiável do navegador, conferir processos locais e renovar
   sessão sintética antes de cada bloco que ultrapasse 900s.
2. Retomar os 137 controles NÃO TESTADOS do livro S19F, começando por seletores de
   vigência contratual e valor-hora pago; depois Containers, Apontamentos,
   Colaboradores/equipes, operações e ações restantes. Não repetir PASS S19C–S19F.
3. Decidir separadamente fator HE inferior a 1, bloqueio de lançamentos em competência
   faturada e eventual ativação de calendário/resolução comercial. Sem migration ou
   alteração global nesta autorização.
4. Concluir fluxos de login/TOTP, convite/recuperação/e-mail em mecanismo de teste
   autorizado e isolado; preservar as limitações anteriores.
5. Correção S19F permanece local; commit/push/publicação dependem de ordem própria.
   Manter PR #106 Draft. Sem merge, Production ou publicação sobre staging estável.

**Critério de saída não atingido:**137 não testados e64 bloqueados. NO-GO.

## Evidências locais e reprodução

Diretório de evidências: `/private/tmp/bs-session-19-evidence` (artefatos locais, não versionados). `baseline-tests.json` e `final-tests.json` listam cada suíte, exit code e log; `http-local.json` (38), `hml-auth.json` (44) e `app-hml.json` (16) listam cada caso. `financial-reference.json`, `app-financial.json` e `candidate-files.json` ligam valores, recorte e hashes dos arquivos de código. `dashboard-red.log`/`dashboard-green.log` preservam RED/GREEN. O harness externo registra apenas resultados sanitizados.

`test-hml-auth.py` **cria novas identidades** ao executar: não repetir automaticamente. `test-app-hml.py` abre sessões das contas S19 e um servidor local/HML, encerrado em `finally`. O servidor inerte 3199 foi encerrado pelo prazo de 900 s do runner. Nenhum desses comandos é reset ou migration.

| Arquivo sintético           | Abas reais                                   | SHA-256                                                          |
| --------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| s19-fechamento-interno.xlsx | Resumo, Por colaborador, Detalhamento diário | f306f283432e21faa9bd981fb26c535a446529daecf80fe435f660c4db20cb0b |
| s19-fechamento-cliente.xlsx | Fechamento, Resumo por colaborador           | 552cd4a814b0f7cc7ff73027066bdea86da2b93d4e12397d2eea39745bfd71a0 |
