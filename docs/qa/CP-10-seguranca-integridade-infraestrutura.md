# QA-BS-01 · Sessão 15 — CP-10 (Segurança, integridade e infraestrutura)

Sessão 15 (14/11/2026, sessão em nuvem, Linux, Supabase local descartável). Base: HEAD
`d25af37eafc832ca01e605d7792f33698ba28a52` (CP-09). PR #134 (Draft).

**Status: PASS COM PENDÊNCIAS BLOQUEANTES.** A auditoria do escopo foi executada, os testes estão
verdes e os riscos estão classificados. O uso financeiro real (piloto com faturas reais) segue
**NO-GO**: o banco aceita jornadas impossíveis, duplicidade de cobrança e emissão diferente do
conferido, e não existe cancelamento de fatura (seção "Gates financeiros"). Conclusão da auditoria
**não** é aprovação para Production.

## Isolamento

- HEAD local = remoto no início; árvore limpa (só `supabase/.branches/`, não versionado); nenhuma
  variável `SUPABASE_*` no ambiente do processo. Scripts remotos antigos seguem desativados
  (`*.REMOTO-NAO-EXECUTAR`) e não foram usados.
- Só Supabase local (`bs-e2e-cp04` para iteração, `bs-e2e-cp10` E2E oficial, `bs-fin11-cp10` SQL),
  criados e encerrados pelo próprio `project_id`; `config.toml` restaurado depois de cada uso.
- Nenhum acesso a HML, Preview ou Production; nenhuma API de gerenciamento remoto (Supabase,
  Vercel, configuração do GitHub). Única consulta externa: `npm audit` ao registro público. O
  incidente das 4 chamadas vazias ao HML (CP-04/CP-05) continua registrado e não se repetiu.
- Os testes do banco rodam como `postgres` local, que **é superusuário** (o de Production não é):
  provas de privilégio aqui valem para a lógica das funções e policies, não para a ACL de Production.

## Classificação usada

| Rótulo                     | Significado                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| **CORRIGIDO**              | defeito reproduzido (RED), corrigido no código da aplicação e GREEN                          |
| **COMPROVADO SEGURO**      | proteção exercida por teste nesta sessão; o teste falha se ela sumir                         |
| **RISCO REPRODUZIDO**      | o banco aceita hoje algo que não deveria; reproduzido com dados sintéticos e fixado em teste |
| **NÃO TESTADO**            | fora do alcance local ou desta sessão                                                        |
| **DEPENDE DE AUTORIZAÇÃO** | correção exige migration, RPC, RLS/grant ou decisão comercial                                |

## 1. Superfície de ataque inventariada

| Superfície           | Quantidade                                                                                                                                        | Proteção                                                                          | Evidência                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| Páginas (App Router) | 25: 14 telas do painel, 4 redirecionamentos de `/containers/*`, 6 de acesso e `/`                                                                 | guard do layout (`lerAcesso`) + RLS                                               | CP-01, spec 41                                 |
| Route handlers       | 5: `GET /api/fechamento`, `POST /api/fechamento/xlsx`, `POST /api/fechamento/xlsx-cliente`, `GET /api/calendario/municipios`, `GET /auth/confirm` | `lerAcesso()` dentro de cada rota; os POST só geram arquivo (sem efeito no banco) | 401 com código estável sem sessão (curl local) |
| Server Actions       | 7 módulos: painel (logout), contêiner legado, implantação de vigências, usuários, recuperação (3)                                                 | `exigirAdminAtor()` / prova HMAC; checagem de origem do Next                      | CP-01, spec 41 P3                              |
| Tabelas de `public`  | 31                                                                                                                                                | RLS em todas, ≥ 1 policy cada                                                     | SQL S3; spec 99 M1                             |
| Funções de `public`  | 186; 110 `SECURITY DEFINER`; **65** executáveis por `authenticated`; **0** por `anon`                                                             | guarda de papel e piso de MFA dentro de cada DEFINER                              | SQL S1–S7; spec 99 M2–M3                       |
| Serviços             | PostgREST, Auth (GoTrue), Mailpit (só local)                                                                                                      | chave publicável + JWT; `service_role` só no servidor                             | spec 99 M6; `test:seguranca-cp10` B2           |
| Terceiros            | Vercel (hospedagem), Sentry (só Production)                                                                                                       | coleta restrita; DSN público por natureza                                         | leitura de `sentry.*.config.ts`                |

## 2. Autenticação e MFA

| Controle                                                                                                                    | Situação                                      | Evidência                                                                            |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Sem cadastro público; contas por convite                                                                                    | COMPROVADO SEGURO (local)                     | CP-01 (spec 40)                                                                      |
| Login com mensagem neutra; conta revogada/banida                                                                            | COMPROVADO SEGURO                             | spec 40, 41                                                                          |
| MFA TOTP opcional; conta com fator barrada em AAL1 no app e no banco                                                        | COMPROVADO SEGURO                             | spec 40; SQL 032/034                                                                 |
| Recuperação: token não consumido em GET; HMAC; um TOTP; link reusado/inválido                                               | COMPROVADO SEGURO                             | spec 40; `test:recuperacao`, `test:prova`                                            |
| Sem destino de redirect vindo da URL (`next`, `redirect_to`)                                                                | COMPROVADO SEGURO                             | `test:seguranca-cp10` C3; leitura de `/auth/confirm`                                 |
| JWT emitido antes do logout, ainda no prazo, não lê nem chama RPC                                                           | COMPROVADO SEGURO                             | **spec 99 M6** (novo)                                                                |
| JWT de conta revogada/papel removido                                                                                        | COMPROVADO SEGURO                             | spec 41 P4                                                                           |
| Logout do painel com `signOut()` escopo global                                                                              | COMPROVADO SEGURO (forma do código)           | `test:seguranca-cp10` C1                                                             |
| Configuração real do Auth (expiração do JWT, rotação e inatividade do refresh token, rate limit, política de senha, e-mail) | **NÃO VERIFICADA**                            | o `config.toml` não tem `[auth]` de propósito; só o Dashboard de Production comprova |
| Admin sem MFA protegido só pela senha                                                                                       | risco aceito pelo proprietário (SEGURANCA.md) | para o piloto real: condição operacional "todo admin com MFA"                        |

## 3. Cookies e sessões

| Cookie                                          | HttpOnly | Secure      | SameSite | Validade                              | Situação                                                                                                                                                                       |
| ----------------------------------------------- | -------- | ----------- | -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sb-…-auth-token` (sessão Supabase)             | **não**  | sim         | Lax      | ~400 dias (padrão do `@supabase/ssr`) | por desenho: o cliente do navegador precisa lê-lo. Controle compensatório: CSP com nonce, sem `unsafe-inline` em script (spec 99 M7). Um XSS levaria os tokens: risco residual |
| token de recuperação pendente (`/auth/confirm`) | sim      | em produção | Lax      | curto, apagado no uso                 | COMPROVADO SEGURO (CP-01)                                                                                                                                                      |
| prova HMAC da recuperação                       | sim      | em produção | Lax      | validade do link                      | COMPROVADO SEGURO (CP-01)                                                                                                                                                      |

Sessões simultâneas: cada login cria uma sessão própria; o logout do painel é global e encerra
todas; a troca de senha encerra as outras (`scope: "others"`). Acesso depois de mudar o papel:
o papel é lido ao vivo (`has_role` + identidade utilizável), testado no CP-01.

## 4. Matriz de autorização (API direta, sem interface)

Spec **99** (nova, roda por último no E2E): para cada uma das 31 tabelas e cada persona, `SELECT`,
`INSERT {}`, `UPDATE` da linha real (pela chave primária) e `DELETE` da linha real pelo PostgREST,
com a chave publicável e o JWT da própria conta; a contagem no banco é conferida antes e depois.

| Persona     | Tabelas (SELECT / INSERT / UPDATE / DELETE)                                                                                                     | RPCs `SECURITY DEFINER` (65)                                                           | Situação          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------- |
| ADMIN       | lê o núcleo (15 tabelas com linhas; controle M0); **não** escreve em `invoices`/`invoice_items` (M4) nem altera/exclui lançamento faturado (M5) | passa da guarda em 60; recusado pelo papel nas 5 do operador (M3)                      | COMPROVADO SEGURO |
| OPERACIONAL | 0 linha lida (salvo o próprio `profiles`/`user_roles`), nada inserido, alterado ou excluído                                                     | recusadas, salvo 3 booleanos sobre o próprio chamador e `listar_operacoes_do_operador` | COMPROVADO SEGURO |
| SEM PAPEL   | idem                                                                                                                                            | recusadas, salvo os 3 booleanos                                                        | COMPROVADO SEGURO |
| ANÔNIMO     | idem (sem a própria linha)                                                                                                                      | todas recusadas (sem `EXECUTE`)                                                        | COMPROVADO SEGURO |

A matriz cobre clientes, contratos, colaboradores, custos, operações, turnos, equipes,
apontamentos, adicionais, faturas e itens, serviços históricos de contêiner, auditoria e acesso por
operação (todas as tabelas de `public`); a administração de usuários fica no servidor (spec 41 P3).
Não é vazia: o admin lê as tabelas de controle, e toda RPC chegou ao banco (nenhum `PGRST202`).
**Limite:** numa execução isolada, 5 tabelas estavam vazias (`contract_employee_rates`,
`contract_rate_terms`, `financial_calendar_coverage`, `municipality_catalog`,
`operation_location_terms`); nelas `UPDATE`/`DELETE` não provam nada (o `SELECT` e o `INSERT`
provam). A anotação do teste lista as vazias de cada execução.

## 5. RLS, grants e RPCs

- **S1** toda função `SECURITY DEFINER` de `public` fixa `search_path`; **S2** nenhuma é executável
  por `anon` ou `PUBLIC`; **S3** toda tabela tem RLS e policy — COMPROVADO SEGURO.
- **S4–S7** varredura: as 65 DEFINER executáveis por `authenticated` foram chamadas com argumentos
  nulos por três contas. Sem papel e operacional recebem 42501 em todas, salvo
  `identidade_atual_utilizavel`, `mfa_bloqueia_excecao_aal1` e `mfa_cotidiano_ok` (respondem só
  sobre o chamador) e, para o operador, `listar_operacoes_do_operador`. O admin, controle, passa da
  guarda (erro de payload nulo, 22023) e é recusado só nas 5 RPCs do operador — a recusa das outras
  personas é do papel. **Nenhuma elevação de privilégio encontrada.** — COMPROVADO SEGURO.
- Grants de tabela (`authenticated` com `SELECT/INSERT/UPDATE/DELETE` em 11 tabelas: as 8 do CRUD
  das telas, `profiles`, `user_roles` e `user_operation_access`): não dão acesso sem a policy (M1). Ver residual já registrado em SEGURANCA.md.

## 6. Integridade dos apontamentos (AUT-CP05-01)

Suíte SQL **090** (nova), casos I, e prova com o motor **ligado** (configuração de Production) pelas
RPCs que as telas usam, em transação desfeita:

| Caso                                                                   | Situação                                 | Evidência                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saída antes da entrada em turno diurno (08:00→07:50)                   | **RISCO REPRODUZIDO**                    | gravado pela API direta (I1: 1.430 min, I1b: cobrança acima da diária); pela `salvar_apontamento_admin` com motor ligado: **1.370 min, R$ 953,13 num dia**; pela `salvar_apontamento_operacional`: **R$ 632,50**. Só as telas bloqueiam (CP-05, D1) |
| Virada legítima da meia-noite (22:00→07:00)                            | COMPROVADO SEGURO                        | I2: 480 min                                                                                                                                                                                                                                         |
| Entrada = saída; intervalo negativo                                    | COMPROVADO SEGURO                        | I3, I4 (23514)                                                                                                                                                                                                                                      |
| Intervalo maior que a jornada (08:00→09:00, 300 min)                   | **RISCO REPRODUZIDO**                    | I5: jornada 0, diária cobrada                                                                                                                                                                                                                       |
| Duplo envio (mesmo colaborador, mesma folha)                           | COMPROVADO SEGURO                        | I6 (23505, unicidade diária)                                                                                                                                                                                                                        |
| Duas abas / versão obsoleta                                            | **RISCO REPRODUZIDO** no banco           | I7: a 2ª gravação vence em silêncio; a tela do admin confere a versão (CP-05), a do operador e a API não                                                                                                                                            |
| Operacional/sem papel gravando direto                                  | COMPROVADO SEGURO                        | I8                                                                                                                                                                                                                                                  |
| Valor no payload                                                       | COMPROVADO SEGURO                        | I9: derivação sobrescreve `billed_amount`                                                                                                                                                                                                           |
| Lançamento faturado: alterar, excluir, custo e diária alterados depois | COMPROVADO SEGURO                        | F8, F9; spec 99 M5                                                                                                                                                                                                                                  |
| Folha fechada                                                          | COMPROVADO SEGURO                        | SQL 030 F1–F3                                                                                                                                                                                                                                       |
| Reabertura de dia faturado                                             | **RISCO REPRODUZIDO** (decisão pendente) | F11: permitida; o faturado segue imutável                                                                                                                                                                                                           |
| Horário impossível (`25:00`)                                           | COMPROVADO SEGURO                        | tipo `time` do Postgres recusa                                                                                                                                                                                                                      |

**Proteção por camada** — interface: D1 bloqueia até corrigir/confirmar (admin e operador);
servidor: nenhuma (as RPCs gravam o que recebem); banco: só `entrada = saída`, intervalo negativo,
unicidade, folha fechada e faturado. **A interface não é a fronteira**: um token de admin ou
operador grava a jornada impossível sem passar pela tela.

## 7. Integridade do faturamento (AUT-CP07-01)

| Caso                                                       | Situação                            | Evidência                                                                                            |
| ---------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Valor confirmado × emitido                                 | **RISCO REPRODUZIDO**               | F1: `gerar_fatura(_client_id, _period_start, _period_end)` não recebe o total nem a lista conferida  |
| Lançamento e adicional criados entre conferência e emissão | **RISCO REPRODUZIDO**               | F2: ambos entram na fatura; a tela avisa depois (D-CP07-03)                                          |
| Itens somam o total; vínculo de todos os lançamentos       | COMPROVADO SEGURO                   | F3                                                                                                   |
| Dia aberto                                                 | **RISCO REPRODUZIDO** (DEC-CP07-01) | F4; a confirmação lista os dias abertos (D4)                                                         |
| Repetir a emissão; fatura sem lançamentos                  | COMPROVADO SEGURO                   | F5 (P0002); nenhuma fatura vazia                                                                     |
| Competência incorreta; período invertido                   | COMPROVADO SEGURO                   | F6 (22023)                                                                                           |
| Fatura complementar na mesma competência                   | **RISCO REPRODUZIDO** (DEC-CP07-02) | F7: 2ª fatura aceita; a tela avisa (D-CP07-04)                                                       |
| Alterar/excluir faturado; escrever direto em fatura        | COMPROVADO SEGURO                   | F8, F10; spec 99 M4, M5                                                                              |
| Duas sessões concorrentes; resposta de rede perdida        | COMPROVADO SEGURO                   | trava por cliente (`pg_advisory_xact_lock`) + `FOR UPDATE` + conferência de vínculo; spec 95 (CP-07) |
| Cancelamento ou estorno de fatura                          | **NÃO EXISTE** (DEC-CP07-03)        | F12: nenhuma função                                                                                  |

## 8. Duplicidade financeira (DEC-CP06-04)

| Caso                                                                                                      | Classe                       | Evidência                               |
| --------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------- |
| Mesma chave de idempotência, mesmo payload (reenvio após falha)                                           | **A — o banco impede**       | D1                                      |
| Mesma chave, payload diferente                                                                            | **A — o banco impede**       | D2 (23505)                              |
| Mesmo colaborador duas vezes na mesma folha                                                               | **A — o banco impede**       | I6                                      |
| Repetir a emissão da fatura                                                                               | **A — o banco impede**       | F5                                      |
| Registro antigo de contêiner + operação avulsa da mesma operação                                          | **B — a interface só avisa** | D4; aviso D-CP06-01/D-CP07-05           |
| Fatura complementar                                                                                       | **B — a interface só avisa** | F7; D-CP07-04                           |
| Avulsa + adicional manual do mesmo serviço                                                                | **C — não detectado**        | D5                                      |
| Dois adicionais iguais (mesmo serviço, referência e valor) com chaves diferentes (duas abas, dois admins) | **C — não detectado**        | D3                                      |
| Duas operações avulsas aparentemente iguais                                                               | **C — não detectado**        | nenhuma regra de unicidade; por leitura |

**D5 reproduz o caso extremo:** o mesmo contêiner cobrado **quatro vezes** numa só fatura —
2 diárias da avulsa (R$ 500) + 2 adicionais iguais (R$ 1.000) + 1 registro antigo (R$ 500) =
**R$ 2.000**. A ausência de registros antigos em Production elimina só a parcela de R$ 500; as
outras duas formas (C) existem em qualquer banco.

## 9. RPC legada de contêiner (AUT-CP06-01)

| Persona                 | Resultado                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin                   | **RISCO REPRODUZIDO** — C1: `registrar_servico_container` ainda cria registro e um adicional de R$ 300 que entra na fatura. O painel saiu no CP-06B e a Server Action recusa (`test:seguranca-cp10` C2), mas a RPC do banco não |
| Repetição (mesma chave) | COMPROVADO SEGURO — C2, mesmo registro                                                                                                                                                                                          |
| Payload inválido        | COMPROVADO SEGURO — C3, recusado                                                                                                                                                                                                |
| Operacional, sem papel  | COMPROVADO SEGURO — C4 (42501)                                                                                                                                                                                                  |
| Anônimo                 | COMPROVADO SEGURO — sem `EXECUTE`                                                                                                                                                                                               |

Impacto real: um admin com token cria receita por um caminho que não aparece mais na interface
(equivalente a um adicional manual, mas com custo próprio e sem a tela de adicionais). Proposta P3.

## 10. Contratos e vigências (DEC-CP02-01, CN-D)

| Caso                                                         | Situação                                 | Evidência                                                                        |
| ------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------- |
| Lançamento depois do fim do contrato (inativo)               | **RISCO REPRODUZIDO**                    | K1 (motor desligado, R$ 300); CN-D `@falha-conhecida` com motor ligado (spec 50) |
| Contrato vigente, futuro, alteração de vigência              | COMPROVADO SEGURO (pela regra existente) | specs 10, 50, 98 (VF1/VF2)                                                       |
| Condição comercial e custo históricos congelados no faturado | COMPROVADO SEGURO                        | F9                                                                               |
| Faturamento depois do término                                | **RISCO REPRODUZIDO**                    | K1 + F: o dia é faturável como qualquer outro                                    |

**Alternativas (decisão do negócio, não tomada aqui):**

| Política                                                               | Efeito                               | Risco                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| (a) informativo (hoje + aviso no seletor)                              | nada muda                            | cobrança depois do fim passa despercebida                                                  |
| (b) impedir escolher contrato encerrado em operação **nova** (só tela) | evita casos novos                    | operações antigas seguem cobrando                                                          |
| (c) recusar lançamento depois do fim (motor)                           | fecha na origem                      | exige migration e decisão sobre o já lançado; dias legítimos de transição seriam recusados |
| (d) encerrar a vigência das condições junto com o fim                  | sem condição vigente, o motor recusa | exige migration; mexe em histórico de vigências                                            |

Em qualquer política os valores já faturados ficam como estão (snapshots congelados).

## 11. Segurança da aplicação

| Item                                   | Situação                        | Evidência                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dado financeiro no payload do operador | COMPROVADO SEGURO               | spec 20; grants por coluna (SEGURANCA.md)                                                                                                                                                                           |
| `service_role` e segredos no navegador | COMPROVADO SEGURO               | busca no `.next/static` do build local: nenhum nome de segredo nem a chave; `test:seguranca-cp10` B1–B2                                                                                                             |
| XSS em campos livres                   | COMPROVADO SEGURO (por leitura) | React escapa; único `dangerouslySetInnerHTML` no gráfico shadcn não usado (B3–B4); CSP com nonce (M7)                                                                                                               |
| CSRF                                   | COMPROVADO SEGURO (por leitura) | Server Actions com checagem de origem do Next; rotas POST só geram arquivo; cookie Lax                                                                                                                              |
| CORS                                   | COMPROVADO SEGURO (por leitura) | rotas do Next sem cabeçalho CORS (só mesma origem); PostgREST é do Supabase e autoriza pelo JWT                                                                                                                     |
| Redirecionamentos                      | COMPROVADO SEGURO               | destinos constantes (C3)                                                                                                                                                                                            |
| Erros com estrutura interna            | COMPROVADO SEGURO               | rotas devolvem código estável; detalhe só no log do servidor                                                                                                                                                        |
| Exportação CSV                         | COMPROVADO SEGURO               | neutralização de fórmula (`test:fechamento-csv`; `montarCsv` nas três exportações)                                                                                                                                  |
| Exportação XLSX                        | COMPROVADO SEGURO (por leitura) | texto como `String`; a única fórmula é `SUBTOTAL` de colunas calculadas                                                                                                                                             |
| Uploads                                | NÃO APLICÁVEL                   | não existem                                                                                                                                                                                                         |
| Rate limiting                          | **NÃO VERIFICADO**              | Auth remoto; as rotas da aplicação não limitam (todas exigem admin)                                                                                                                                                 |
| Logs                                   | informativo                     | 4 `console.error` no servidor registram a mensagem de erro do banco (sem token ou senha); mensagens de unicidade podem citar valores                                                                                |
| `X-Powered-By: Next.js`                | **CORRIGIDO** (D-CP10-01)       | M7 RED → GREEN                                                                                                                                                                                                      |
| Dependências                           | **RISCO** (dev/build)           | `npm audit`: 12 moderadas, 0 altas/críticas; todas em `glob`/`minimatch` via plugin de build do Sentry e `typescript-eslint` — fora do caminho da requisição. SEGURANCA.md pede zero: atualização em tarefa própria |

## 12. Infraestrutura e ambientes

| Item                                                                                                   | Situação                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CSP com nonce, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options | COMPROVADO SEGURO (M7, servidor local)                                                                                                                                                                                                                                                                                                     |
| HSTS                                                                                                   | NÃO VERIFICADO (vem da Vercel, fora do repositório)                                                                                                                                                                                                                                                                                        |
| `proxy.ts` (não `middleware.ts`) renova a sessão e monta a CSP                                         | COMPROVADO SEGURO (testes do CP-01)                                                                                                                                                                                                                                                                                                        |
| Isolamento Preview × Production no build e por requisição                                              | COMPROVADO SEGURO localmente (`test:isolamento`); com Preview real: NÃO VERIFICADO                                                                                                                                                                                                                                                         |
| **Preview automático do #134 ligado ao HML** (AMBIENTES.md)                                            | **NÃO VERIFICADO nesta sessão.** Pela configuração registrada, cada push gera um Preview de código **não homologado** apontando para o HML compartilhado; não grava sozinho, mas quem abrir o link opera o HML com esse código. Recomendação: proteção do Preview (SSO, já registrada) e não usar o Preview do #134 para dados até o CP-12 |
| GitHub Actions                                                                                         | COMPROVADO SEGURO por leitura: `permissions` mínimas (`contents: read`; `{}` nos de checkpoint), nenhum `pull_request_target`, nenhum secret remoto nem `db push`; o checkpoint automático segue travado (`if: false &&`)                                                                                                                  |
| Vercel                                                                                                 | `vercel.json` com `main: false` (o merge não publica sozinho); variáveis e Deployment Protection: NÃO VERIFICADAS                                                                                                                                                                                                                          |
| Migration automática                                                                                   | nenhuma no repositório (scripts só `--local`); integração Supabase↔GitHub (branching): NÃO VERIFICADA                                                                                                                                                                                                                                      |
| `project_id` versionado = referência de Production (`ehkduq…`)                                         | risco operacional conhecido (já houve commit acidental, revertido em `acd1747`). Mitigação existente: o E2E recusa as referências de HML e Production (travas 25/25); o runner SQL só usa `--local` e `docker exec`. Recomendação: trocar o valor versionado por um nome local neutro em tarefa própria                                    |
| Scripts `comparar-catalogo-*.sh` com `supabase@latest`                                                 | risco de cadeia de fornecimento (versão não fixada); só comandos locais. Recomendação: fixar `@2.117.0`                                                                                                                                                                                                                                    |
| Sentry                                                                                                 | só Production envia; sem dados do usuário, corpo, cookies, cabeçalhos; sem replay                                                                                                                                                                                                                                                          |
| Proteção de branch no GitHub                                                                           | NÃO VERIFICADA (exigiria a API de configuração)                                                                                                                                                                                                                                                                                            |

## 13. Defeitos RED/GREEN

| ID        | P   | Defeito                                                                                                                                                                                                                                                                                                                              | Correção                                                                            | Teste                                                                                                                       |
| --------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| D-CP10-01 | P3  | Toda resposta anunciava `X-Powered-By: Next.js` (fingerprint do framework)                                                                                                                                                                                                                                                           | `poweredByHeader: false` em `next.config.ts`                                        | spec 99 M7 (RED no build do `d25af37`, GREEN); `test:seguranca-cp10` A1                                                     |
| D-CP10-02 | P3  | Na grade do dia (admin e operador), presença, entrada, saída, intervalo e observação de cada linha não tinham nome acessível. Achado no **1º E2E completo do CP-10** (14/11): com os dados de todas as specs, a seleção padrão de `/apontamentos` passou a ter equipe; no CP-09 a grade estava vazia e a auditoria não viu os campos | `aria-label` por linha com o nome do colaborador ("Entrada de Ana") nas duas grades | spec 98 "AU grade" com a grade **preenchida** (RED 4 campos sem nome em 390 e 1366 px → GREEN); `test:interface-cp09` E3–E4 |

Correções de infraestrutura de teste, sem efeito no produto:

- **Clique antes da hidratação:** no mesmo E2E completo, o primeiro clique em "Novo cliente" da spec
  98 caiu antes de o React hidratar a página (o HTML do servidor já mostra o botão) e o diálogo não
  abriu; as 9 dependentes falharam em cascata. O helper `abrirDialogoPor` (e2e/apoio/telas.ts)
  repete o clique só enquanto nenhum diálogo estiver aberto — nenhuma asserção foi afrouxada.
- **Lint travado:** o relatório local do Playwright (`e2e-results/`, ignorado pelo Git) traz o
  visualizador de traces minificado; `eslint .` levou mais de 19 min nele (12 s sem ele).
  `e2e-results` entrou nos `ignores` do `eslint.config.js`.

Nenhum outro defeito do escopo autorizado (código de aplicação) foi encontrado. Os riscos das
seções 6 a 10 estão no **banco**: corrigi-los na tela seria improvisado e não fecharia a API, por
isso ficam como propostas (seção 14) e **não** são marcados como resolvidos.

## 14. Propostas de hardening (não executadas; exigem autorização)

| ID        | Problema                                                      | Proposta                                                                                                                                                                                                                                                                                                                                                                                                                                          | Exige                                                                           |
| --------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| P-CP10-01 | AUT-CP05-01: jornada impossível e intervalo > jornada aceitos | Trigger em `timesheet_entries`: recusar `check_out < check_in` quando o turno não vira a meia-noite, salvo confirmação registrada (coluna `jornada_confirmada_por/_em`, preenchida só pelas RPCs com a confirmação da tela); limite de duração (DEC-CP05-01); recusar intervalo maior que o período trabalhado                                                                                                                                    | migration + contrato das RPCs `salvar_apontamento_*` (novo campo) + DEC-CP05-01 |
| P-CP10-02 | Versão obsoleta na API e no operador                          | Parâmetro `versao_esperada` (`updated_at` lido) por linha nas RPCs de salvamento; recusar com 40001 quando divergir                                                                                                                                                                                                                                                                                                                               | contrato de RPC                                                                 |
| P-CP10-03 | AUT-CP07-01: emissão ≠ conferido                              | `gerar_fatura` com `_assinatura_esperada` (hash da lista de lançamentos/adicionais e do total que a tela conferiu, como a assinatura que o Fechamento já usa no XLSX); divergência recusa com 40001 e nada é gravado; a assinatura antiga é revogada depois da migração da tela                                                                                                                                                                   | migration + contrato de RPC                                                     |
| P-CP10-04 | AUT-CP06-01: RPC legada cria receita                          | Migration: `REVOKE EXECUTE ON FUNCTION registrar_servico_container FROM authenticated` (ou `raise` no início). `cancelar_` e `corrigir_` ficam para o histórico; nada é apagado                                                                                                                                                                                                                                                                   | migration (REVOKE)                                                              |
| P-CP10-05 | DEC-CP06-04: duplicidade C                                    | Opções: (1) `gerar_fatura` recusa ou exige confirmação quando a mesma operação avulsa tem diárias **e** adicional/registro antigo vinculado a ela; (2) índice único parcial em `billing_additionals (client_id, operation_id, reference, billing_period_start) where canceled_at is null and reference is not null`; (3) aviso na tela de adicionais ao repetir referência. A escolha depende de quando o negócio cobra adicional junto da diária | decisão comercial + migration                                                   |
| P-CP10-06 | DEC-CP07-03: sem cancelamento/estorno                         | Função `cancelar_fatura(id, motivo)` que marca a fatura como cancelada, desvincula os lançamentos e adicionais **sem apagar** itens, com auditoria e só para admin; ou fatura de estorno (crédito) espelhando os itens                                                                                                                                                                                                                            | decisão comercial + migration + RPC                                             |
| P-CP10-07 | Reabertura de dia faturado (F11)                              | Recusar `timesheets.status = open` quando houver lançamento faturado, ou exigir motivo auditado                                                                                                                                                                                                                                                                                                                                                   | decisão + migration                                                             |
| P-CP10-08 | DEC-CP02-01                                                   | Uma das políticas (a)–(d) da seção 10                                                                                                                                                                                                                                                                                                                                                                                                             | decisão comercial (+ migration em c/d)                                          |
| P-CP10-09 | Dependências                                                  | atualizar `@sentry/nextjs` e `typescript-eslint` quando houver versão corrigida; reconferir `npm audit`                                                                                                                                                                                                                                                                                                                                           | tarefa própria (dependências)                                                   |
| P-CP10-10 | Infra                                                         | `project_id` versionado neutro; `supabase@2.117.0` nos `comparar-catalogo-*.sh`                                                                                                                                                                                                                                                                                                                                                                   | tarefa própria                                                                  |

## 15. Gates financeiros — revisão crítica

A matriz do CP-09 tratava como "não bloqueantes" a duplicidade, a integridade do apontamento e a
conferência atômica da fatura, apoiada em "um único admin" e "sem registros antigos". **Os dois
argumentos não se sustentam como prova:** o banco aceita as três falhas por qualquer token de
admin (e o apontamento também pelo operador), a duplicidade C existe sem registro antigo (D3, D5),
e não há como desfazer uma fatura (F12). A matriz abaixo **substitui** a do CP-09.

Critério para "ACEITÁVEL COM CONTROLE COMPROVADO": condição operacional explícita **e** controle
existente e testado **e** impacto residual conhecido **e** responsável **e** procedimento em caso de
falha. Sem procedimento de falha, não é aceitável.

**Cenário A — demonstração com dados fictícios, sem cobrança real.** Condição: ambiente local ou
HML autorizado, dados sintéticos, nenhuma fatura enviada a cliente, ninguém toma decisão financeira
pelos números.

**Cenário B — piloto operacional com dados reais e faturas reais.**

| Risco                                                                  | Controle existente (testado?)                                     | Cenário A                                       | Cenário B                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUT-CP05-01 — jornada impossível aceita pelo banco (R$ 953,13 num dia) | tela bloqueia/confirma (spec 80 D1, sim); banco não               | ACEITÁVEL COM CONTROLE                          | **BLOQUEANTE** — a tela permite confirmar, o banco aceita, a fatura não se desfaz                                                                                                                                                                          |
| Versão obsoleta (duas abas)                                            | tela do admin confere a versão (spec 80, sim); operador e API não | ACEITÁVEL COM CONTROLE                          | ACEITÁVEL COM CONTROLE — condição: um único lançador por operação e dia; responsável: admin; falha: corrigir antes de emitir (lançamento não faturado é editável)                                                                                          |
| AUT-CP06-01 — RPC legada cria receita                                  | sem caminho na interface (spec 90, `test:seguranca-cp10` C2, sim) | ACEITÁVEL COM CONTROLE                          | ACEITÁVEL COM CONTROLE — condição: nenhum uso da API fora da aplicação; o registro aparece no Fechamento como "registro antigo" com aviso; falha antes de emitir: `cancelar_servico_container` (CP-06, testado). Depois de emitida: depende de DEC-CP07-03 |
| AUT-CP07-01 — emissão ≠ conferido                                      | aviso depois da emissão (D-CP07-03, spec 95, sim)                 | ACEITÁVEL COM CONTROLE                          | **BLOQUEANTE** enquanto DEC-CP07-03 não tiver procedimento: o aviso chega depois que a fatura já é definitiva                                                                                                                                              |
| DEC-CP06-04 — duplicidade C (avulsa + adicional; adicional repetido)   | nenhum controle no banco nem na tela para C                       | ACEITÁVEL COM CONTROLE                          | **BLOQUEANTE** — 4× o mesmo serviço reproduzido (D5) sem aviso; conferência humana do Fechamento não é controle testado                                                                                                                                    |
| DEC-CP02-01 — cobrança depois do fim do contrato                       | seletor identifica e avisa (D-CP04-04, sim)                       | ACEITÁVEL COM CONTROLE                          | **DECISÃO COMERCIAL PENDENTE** — aceitável só com a condição "nenhum contrato do piloto com fim cadastrado" até a decisão                                                                                                                                  |
| DEC-CP07-01 — dia aberto faturado                                      | confirmação lista dias abertos (D4, spec 95, sim)                 | ACEITÁVEL COM CONTROLE                          | ACEITÁVEL COM CONTROLE — condição: fechar todos os dias antes de emitir; responsável: admin emissor; falha: depende de DEC-CP07-03 (por isso só vale junto com ele)                                                                                        |
| DEC-CP07-02 — fatura complementar                                      | aviso na confirmação (D-CP07-04, sim)                             | NÃO APLICÁVEL                                   | ACEITÁVEL COM CONTROLE — caso legítimo; não duplica lançamento faturado (F5, F8)                                                                                                                                                                           |
| DEC-CP07-03 — sem cancelamento/estorno                                 | nenhum                                                            | NÃO APLICÁVEL                                   | **BLOQUEANTE** — multiplica a gravidade de todos os riscos de emissão indevida acima                                                                                                                                                                       |
| Reabertura de dia faturado (F11)                                       | faturado imutável (F8, sim)                                       | NÃO APLICÁVEL                                   | ACEITÁVEL COM CONTROLE                                                                                                                                                                                                                                     |
| Cobrança por produção (contêiner por unidade)                          | não existe; a tela diz que não existe (D-CP09-03)                 | NÃO APLICÁVEL                                   | **DECISÃO COMERCIAL PENDENTE** — **BLOQUEANTE** se o piloto tiver serviço cobrado por quantidade: sairia como diária × participantes                                                                                                                       |
| Feriados vazios em Production                                          | nenhum                                                            | NÃO APLICÁVEL                                   | **BLOQUEANTE** (dado; cadastro autorizado)                                                                                                                                                                                                                 |
| Código de Production desatualizado (D5)                                | nenhum                                                            | NÃO APLICÁVEL (demonstração fora de Production) | **BLOQUEANTE** (publicação autorizada do SHA homologado)                                                                                                                                                                                                   |
| Admin sem MFA                                                          | MFA opcional por decisão do proprietário                          | NÃO APLICÁVEL                                   | ACEITÁVEL COM CONTROLE — condição: todo admin do piloto com MFA ativo                                                                                                                                                                                      |

### GO/NO-GO

- **Cenário A (demonstração fictícia): GO condicionado** — dados sintéticos, ambiente local ou HML
  com autorização nominal, nenhuma fatura enviada a cliente e a explicação de que os números não
  são homologados.
- **Cenário B (piloto financeiro real): NO-GO** — bloqueiam AUT-CP05-01, AUT-CP07-01, DEC-CP06-04
  e DEC-CP07-03 (P-CP10-01, 03, 05, 06), os feriados e a publicação; e a produção, se estiver no
  escopo do piloto.

## 16. Resultados

| Verificação                                                             | Resultado                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| spec 99 (nova)                                                          | 12/12; M7 RED no build do `d25af37` (`X-Powered-By: Next.js`) → GREEN                                                          |
| spec 98 "AU grade" (novo)                                               | RED: 4 campos sem nome por linha em 390 e 1366 px → GREEN 2/2                                                                  |
| SQL 090 (nova)                                                          | 25 SEGURO e 15 RISCO REPRODUZIDO, todos conferidos (no banco do runner e no do E2E)                                            |
| `npm run e2e:local` — 1ª execução                                       | 235 testes · 224 PASS · **10 FAIL** (spec 98: 4 por D-CP10-02, 6 em cascata do clique antes da hidratação) · 1 FALHA CONHECIDA |
| `npm run e2e:local` — final                                             | **237 testes · 236 PASS · 0 FAIL · 1 FALHA CONHECIDA (CN-D) · 0 PULADO · 1533 s** · nenhuma rede externa                       |
| `test:*`                                                                | 81/81 (`test:seguranca-cp10` 10, novo; `test:interface-cp09` 33)                                                               |
| lint · `tsc` · `check:workflow` · `git diff --check` · Prettier · build | PASS                                                                                                                           |
| SQL local                                                               | 53 suítes PASS                                                                                                                 |
| travas                                                                  | 25/25                                                                                                                          |
| `npm audit`                                                             | 12 moderadas (dev/build), 0 altas, 0 críticas                                                                                  |
| Docker no fim                                                           | 0 containers, 0 volumes                                                                                                        |

O E2E passou de 223 para 237 testes (12 da spec 99, 2 da grade preenchida na spec 98). Nenhum
teste anterior foi removido ou afrouxado.

## 17. Riscos residuais

- Os riscos REPRODUZIDOS das seções 6–10 (até a migration autorizada).
- Cookie de sessão legível por JavaScript (~400 dias): depende da CSP; um XSS levaria os tokens.
- Configuração do Auth, HSTS, Vercel, proteção de branch e integração Supabase↔GitHub não
  verificadas a partir do repositório.
- `postgres` local é superusuário: as provas de privilégio desta sessão não substituem a
  conferência de ACL em Production.
- Revisão independente de segurança (humana ou Codex) da QA-BS-01 não feita.

## 18. Autorizações necessárias

| Para                                      | Autorização                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| P-CP10-01/02/03/04/07                     | migration + contrato de RPC, por item, com teste RED/GREEN no SQL local e no E2E     |
| P-CP10-05/06/08                           | decisão comercial primeiro (DEC-CP06-04, DEC-CP07-03, DEC-CP02-01), depois migration |
| P-CP10-09/10                              | tarefa própria (dependências, infraestrutura)                                        |
| Verificar Auth, Vercel, branch protection | leitura autorizada dos painéis (fora desta sessão)                                   |

## 19. Próxima etapa

CP-11 — regressão integrada final, só com nova autorização. Não iniciado.
