# Estado do projeto

## FIN-20D — validação local em 06/11/2026

**QA-20D (runner de compatibilidade):** cada reset local espera o PostgREST recarregar o schema por um canário que passa pelo cache das requisições, com prazo e diagnóstico; alvo local verificado. Série: runner antigo 3/3, novo 5/5. Detalhes e hipótese residual: [HANDOFF](HANDOFF.md).

**R2 em revisão:** o marcador opaco de intenção passa de `sessionStorage` para `localStorage`, com exclusão entre abas por Web Locks (um lock por usuário, sem espera, falha fechado sem a API). Sobrevive ao fechamento da aba; não cobre outro dispositivo/navegador nem armazenamento apagado. Sem valor financeiro no navegador; migration 047, regras comerciais e Containers intactos. Evidências e riscos: [HANDOFF](HANDOFF.md).

**R1 (c011a71):** a chave somente em memória não cobria fechar/recarregar após commit com resposta perdida. O marcador opaco por identidade passa a sobreviver na sessão da aba, sem payload financeiro, para reconciliar antes de reenviar. Registro localizado interrompe a tentativa; ausência na 047 só permite a mesma chave; erro de leitura mantém o bloqueio. Fallback em 045/046 não garante idempotência e resultado desconhecido exige reconciliação administrativa. (Na R1 a proteção valia só para a mesma aba; a R2 amplia.) Migration 047 e regras comerciais permanecem intactas. Evidências atuais e próximo gate: [HANDOFF](HANDOFF.md).

Migration 047 e frontend implementados sobre o head `b7d311f` do PR #108. Chave obrigatória e payload normalizado persistidos, unicidade e trava por cliente; replay devolve o mesmo ID sem novo adicional/auditoria, conflito recebe 23505. Intenção de retry mantida em memória no formulário. Containers preserva sua própria idempotência; faturas seguem protegidas pela 046.

Evidência local: RED no snapshot 046; GREEN 63 SQL e 34 Node focais; 48 suítes SQL, 69 suítes Node, lint, TypeScript, build e compatibilidade 034–047 aprovados; concorrência de adicionais 128/128 e faturas 41/41. Rollback sem uso e recusa com histórico ensaiados. Banco superusuário local não comprova privilégios hospedados. Homologação e implantação remotas pendentes de gates próprios.

Fotografia factual do sistema de **BS Soluções Logísticas**. É a **fonte única**
dos dados que mudam com o tempo (o que está em Production, cobertura de testes,
estado das dependências): os demais documentos apontam para cá em vez de repeti-los.
Etapa atual e próximos passos ficam em [PROGRESS.md](../PROGRESS.md).

## Sessão 16 (05/11/2026)

PR #104 mergeado (`071ea6d`) após correção de compatibilidade com a 034. Backup de Production restaurado
com Auth funcional; ensaio integral 034 → 045 e reversão sobre o banco restaurado, sem erro; margem total
(apontamentos + Containers) no PR #105. Parecer: **NO-GO condicional** para Production. Production segue na 034.
Detalhes em [plano de Production](runbooks/producao-034-045.md), [backup](runbooks/backup-production.md) e
[checklist de e-mail](runbooks/checklist-email-supabase.md).

## Sessão 15 (05/11/2026)

PR #102 mergeado (`b63d33b`). Achado I corrigido no PR #104 (custo de Containers na margem do
Dashboard e dos Relatórios). Backup novo de Production (034) criado e **restaurado em ambiente
isolado** com catálogo e contagens idênticos; Production não tem dados de negócio e não foi
alterada. Config de Auth de HML e Production lida (somente leitura); modelos de e-mail e
expiração dependem do administrador. Evidências no [plano de Production](runbooks/producao-034-045.md).

## Sessão 14 (05/11/2026)

PR documental #101 mergeado (`e7f77b0`). A05 fechado em stack local isolada com captura de
e-mail; E06 executado com a planilha Dynamis (comparação por componente, sem paridade);
achado G explicado, H corrigido no PR #102, I e J registrados. Manual de uso e plano de
Production 034 → 045 redigidos, sem execução. Production segue na 034. Detalhes em
[Homologação integrada](financeiro/homologacao-fin-pr-13.md),
[Manual de uso](MANUAL_DE_USO.md) e [plano de Production](runbooks/producao-034-045.md).

## Integração do FIN-PR-13 e homologação em HML (sessões 11 e 12, 05/11/2026)

**Merge:** PR #100 marcado Ready e mergeado por squash com `--match-head-commit` no HEAD
autorizado `a391079671539ddd89b8e2cd910adb65d68c9a74`; `main` =
`91513b91b11461ac48d8dfe6af118234bfb6fbc0`. CI de `main` (run `42077946742`: `validar` e
`sql-local`) verde. A Vercel publicou Production (`7581007010`, `success`) antes do fim
da CI. `/login` respondeu 200.

**Production `ehkduqokntemtmqzdrbd`:** head 034 (`20261101120000`), lido em transação
`READ ONLY`; nada alterado. Roda código da `main` (045). Rollback não executado: sem
acesso à Vercel e sem candidato comprovadamente compatível melhor que o atual. O último
deploy anterior a qualquer migration 035+ é o de `3f5125c` (`7441801844`, 30/10). A
`main` tem a suíte de compatibilidade 034 → 045 (697 asserções) e a CI não acessa
Production. Smoke não destrutivo: rotas protegidas redirecionam para `/login`.

**HML `qbnfcmrxmssnwkhaitgd`:** head 045 (50 migrations), resolução comercial OFF,
motor por vigência ligado. Dump de dados de `public` antes das escritas. Preparados
contas e dados sintéticos `E2E-S11`: admin, operacional, sem papel, admin+operacional,
conta de MFA, dois clientes, dois contratos, cinco colaboradores, três operações, quatro
turnos, calendário territorial sintético, sete serviços de Containers e duas faturas.

**Execução (app local ligado só ao HML, sem Preview da Vercel):** 27 casos; sessão 12:
17 PASS, 8 PARCIAL, 2 BLOQUEADO; sessão 13: 25 PASS, 1 PARCIAL (A05), 1 BLOQUEADO
(E06), 0 FAIL. Evidência por caso, achados e IDs para limpeza em
[Homologação integrada](financeiro/homologacao-fin-pr-13.md). Resumo: autenticação com
TOTP real, isolamento do operacional, jornada e HE com esperados independentes, nove
fluxos de Containers pelo banco, Fechamento por frequência, faturamento (mista e só
Containers), imutabilidade do faturado e exportações lidas no XML. A sessão 13
ligou a resolução comercial em HML só para B02, C03 e C04 e a **restaurou para OFF**,
exerceu a interface no Chrome real (C05, D04, D05, D09, recuperação) e abriu os `.xlsx`
no Microsoft Excel real com filtros (E03, E04). Não exercido: convite por e-mail e
Dynamis. A regra de HE (15 → 30, 45 → 60) foi corrigida em `ARQUITETURA.md`.
**Não é homologação concluída nem declara o sistema finalizado.**

## FIN-PR-13 — integração e conciliação financeira (05/11/2026)

### Revisão independente — sessão 10

Retomada no HEAD `39e7262f0dd0b7a63a17b58eb902034a670ec15a`, sem alterações
parciais posteriores. CI run `42069242206` e Preview `7579772555` verdes;
CodeRabbit havia pulado a revisão. Outro agente, em contexto separado e somente
leitura, revisou código e contratos e reproduziu quatro achados **P2**, sem
crítico/alto identificado: ajuste negativo legítimo recusado; snapshot serializado
sem validação suficiente (frações que se anulam, versão/detalhes/lastro e contagens
inconsistentes); duplicidades e IDs de Containers sem correspondência; SHA-256
apenas declarado, sem verificação dos bytes pelo CLI.

Correções com RED/GREEN: ajustes signed com lastro; centavos inteiros seguros
validados antes das somas; conferência de versão, detalhes/consolidado, contagens,
colaboradores e ajustes; duplicidade e vínculos ausentes recusados; datas civis
inválidas/invertidas recusadas; CLI verifica arquivo-fonte pelo hash (caminho
relativo ao JSON da base) e códigos 0/1/2. A suíte também confere no XML real o
total e a receita do Container. O revisor repetiu as reproduções e aprovou o delta
final no working tree. Revisão por agente do mesmo modelo não substitui revisão
humana ou homologação. Nenhuma regra comercial, migration, grant ou RLS mudou.

Validação da sessão 10 no working tree revisado: 66/66 suítes, lint,
TypeScript, Prettier, workflow documental, diff check e build aprovados. A matriz
local 034–045 está sendo repetida; seu resultado final e o novo HEAD de CI ficam
no HANDOFF ao encerrar.

Preparada [matriz E2E](financeiro/homologacao-fin-pr-13.md), com 27 casos,
os nove fluxos de Containers, critérios/evidências e distinção entre uso de dados
existentes (a confirmar) e preparação controlada em HML. Todos continuam NÃO
EXECUTADOS. Preview comum não tem secrets de administração/recuperação; esses
casos exigem candidato com capacidade comprovada e autorização específica.

O arquivo `Dynamis Controle de jornada 2026 (1).xlsx` foi esclarecido pelo usuário
como **modelo comercial de referência**, não especificação das regras atuais.
Nova busca local autorizada não encontrou cópia: **modelo externo ainda não
acessível**. Não se inferiram abas/fórmulas nem se forçou equivalência com V2.
A falta do modelo não bloqueia a revisão técnica do PR; limita a comparação
comercial e a validação real do Excel. O plano registra como explicar diferenças
históricas por componente, preservando o motor aprovado.

**Estado:** implementação e validação local concluídas na branch
`feat/fin-pr-13-integracao-conciliacao`, baseada na `main`
`3e5b7b17858fddfcd7fe7f5d96aeff8e6581f420`. O PR
[#100](https://github.com/therunnas/bslogistica/pull/100) foi aberto como Draft no
commit `fcd482f7cb34bc51441d3fc38df52bc36ab34f19` e mergeado depois (sessão 11,
`91513b9`). Nesta fase, nenhum banco remoto, migration, secret ou configuração foi alterado.

**FIN-PR-12 integrado:** o PR #99 foi marcado Ready e mergeado por squash somente
depois da reconfirmação do HEAD autorizado
`9b98b072a146d347a966c64c7c8c7a57669ed91b`, CI verde e estado mergeável. A
`main` resultante é `3e5b7b17858fddfcd7fe7f5d96aeff8e6581f420`. O run de CI de `main`
`42051545919` terminou verde; o deployment automático de Production
`7577211847` terminou `success`, o domínio redirecionou `/` para `/login` e
`/login` respondeu 200 com CSP ligado ao projeto de Production. Isso não homologa
o Excel real.

**O que foi implementado:** `conciliacao-comercial.ts` valida uma base externa com
arquivo e SHA-256, cliente, período, quantidades, total e componentes em centavos:
diárias, horas extras, domingo/feriado, adicional diário, outros adicionais,
Containers e ajustes. A comparação é exata, informa diferenças por componente e
nunca corrige valores. `conciliar-fin-pr-13.mjs` recebe três JSON locais (base,
`FechamentoData` e IDs dos adicionais vinculados a Containers), imprime o relatório
e retorna código diferente de zero quando há divergência ou entrada inválida.

**Prova integrada local:** fixture deliberadamente diferente da Dynamis e stack
Supabase descartável isolada por `project_id` e portas. A matriz 034, 037, 038,
039, 040, 041, 042, 043, 044 e 045 passou com **697 asserções e zero falhas**.
No 045, a RPC real registrou um serviço de dois Containers, receita de R$ 45,67,
custo distribuído de R$ 30,03 e dois participantes; o fechamento separou esse
valor de R$ 12,34 em outro adicional, a fatura conciliou itens/receita/custo e os
XLSX interno e do cliente foram gerados pelas rotas reais. Nos schemas anteriores,
a capacidade de Containers permaneceu ausente de modo seguro. As 66 suítes
`test:*`, lint, TypeScript, workflow documental, Prettier e build também passaram.

**Base Dynamis:** a planilha original de 01–15/09/2026 não foi encontrada nos
worktrees do projeto nem na pasta local autorizada do projeto. Só existem as
referências documentais de 141 apontamentos, 14 colaboradores e R$ 35.118,12
(R$ 33.050,00 em diárias e R$ 2.068,12 em horas extras). Esses números **não foram
usados como esperado de fixture sintética**. A conciliação real e a validação no
Excel continuam pendentes até a fonte original ser fornecida com procedência e
hash verificáveis.

**Pendências preservadas:** nove fluxos reais de Containers, Excel real, jornada
completa de cadastro a faturamento, matriz de segurança/permissões, manual de uso
e preparação controlada de Production 035–045. O projeto não está finalizado.

## FIN-PR-12 — Excel do cliente (modelo Dynamis, 05/11/2026)

**Estado:** mergeado pelo PR #99 em `3e5b7b1`; **não homologado**.
A homologação funcional completa será feita depois do FIN-PR-13, de ponta a ponta,
no Preview ligado ao HML. Nenhuma migration, regra financeira, RLS ou Auth mudou.

**Ambientes (PR #98 integrado em `a2fec9a`):** HML `qbnfcmrxmssnwkhaitgd` na
045 desde 05/11/2026; Production `ehkduqokntemtmqzdrbd` na 034. Os nove fluxos de
Containers (FIN-PR-11) continuam sem homologação. O merge do #98 (05/11/2026 14:14
UTC) publicou Production `dpl_E3iQTUsSjSgC8UqjzBj1Etn6i98G` (READY 14:14:53, antes
da CI de `main`, verde às 14:17:15); domínio 200, CSP com o Supabase de Production.

**O que existe:** no Fechamento, ao lado do "Baixar Excel (.xlsx)" interno, o botão
"Excel do cliente (.xlsx)" chama `POST /api/fechamento/xlsx-cliente` — mesmo
encadeamento de acesso admin, disponibilidade e assinatura de frescor da rota
interna, leitura sob RLS pela sessão. O arquivo tem duas abas:

- **Fechamento:** título "Fechamento – 1ª/2ª quinzena de mês/ano" (ou
  "mês/ano", ou as datas do recorte), cliente e período; uma linha por diária, em
  ordem de colaborador (pt-BR) e data; o ajuste de arredondamento previsto do
  colaborador logo depois das diárias dele; cada adicional de serviço (containers
  inclusive) em linha própria; o ajuste já faturado no fim. Colunas: Colaborador,
  Função, Data, Operação, Tipo do dia, Lançamento, Horas extras (h), Diária, Hora
  extra, Domingo/feriado, Adicional e Total;
- **Resumo por colaborador:** diárias, horas, componentes e total por
  colaborador, mais as linhas de adicionais de serviço e de ajuste já faturado.

Nas duas: autofiltro em todas as colunas, linha `SUBTOTAL(109; …)` que acompanha
o filtro, "Total do fechamento" fixo, datas `dd/mm/aaaa`, moeda `R$`, cabeçalho
congelado, valor sem filtro gravado em cada SUBTOTAL (pré-visualização e modo
protegido não ficam vazios) e recálculo ao abrir. **Sem custo, resultado, margem, já faturado ou a
faturar.** Texto do banco é sempre célula de texto; as únicas fórmulas são os
SUBTOTAL montados pelo gerador.

**Fonte de verdade:** os valores vêm do `FechamentoData` (núcleo e banco). O
modelo só soma para apresentar e **recusa exportar** quando a soma das linhas não é
a receita do Fechamento, quando um componente não fecha com o consolidado, quando
os componentes de um lançamento não somam o cobrado ou quando as diárias do resumo
divergem. A recusa responde 422 `dado-inconsistente`, sem arquivo.

**Validação local (05/11/2026):** suíte nova `test:fechamento-xlsx-cliente` com
92 asserções sobre o arquivo real (fixture sintética V2 com domingo, sábado,
substituto faturado, adicional diário, ajustes de arredondamento e dois containers;
valores conferidos à mão: total R$ 2.259,32), incluindo textos hostis, período
vazio, período só com serviços e a fixture ouro; teste de mutação (adicional fora do
total) barrado. `test:fechamento-xlsx` 279/279 com quatro guardas atualizadas para
a nova rota e o novo gerador. Todas as 65 suítes `test:*`, lint, TypeScript,
Prettier, `git diff --check` e build de produção passaram. A conferência no
Microsoft Excel real não foi concluída: a automação local não abriu a pasta
(diálogo do aplicativo); fica para a homologação.

**Revisão R1 (sessão 07, mesmo agente que implementou — não é revisão
independente no sentido do WORKFLOW):** sem achado crítico ou alto. Corrigidos:
rótulo "Serviço avulso" trocado por "Adicional de serviço", o termo único do
projeto para `billing_additionals`; erro de soma divergente passou de 500 genérico
a 422 `dado-inconsistente`; a rota do cliente entrou na suíte de compatibilidade de
deploy. Resultados: `test:fechamento-xlsx-cliente` 95/95; 65/65 suítes `test:*`;
compatibilidade em cópia isolada, schemas 034 → 045, 685 asserções e 0 falhas —
em **todos**, inclusive a 034 de Production, `POST /api/fechamento/xlsx-cliente`
devolveu 200 com "Total do fechamento" igual à receita do `GET` e sem custo,
margem nem resultado. Assinatura de frescor confirmada cobrindo lançamentos,
adicionais e ajustes exibidos. Excel real continua não verificado.

**Revisão independente (sessão 08):** feita por outro agente, em contexto novo, sem
as conclusões anteriores, somente leitura, sobre `0bbe899` (mesmo modelo de IA: não
substitui revisão humana). Sem achado crítico ou alto. Defeitos demonstrados e
reproduzidos à parte, depois corrigidos com teste antes (RED 7/102, GREEN):

- horas extras do arquivo arredondavam cada lançamento antes de somar (3 × 1 min =
  0,06 h contra 0,05 h no Fechamento): o modelo agora soma minutos e converte uma
  vez por total, e confere os minutos cobrados contra o Fechamento; na aba de
  lançamentos o SUBTOTAL de horas soma as linhas arredondadas (é o que a planilha
  calcula) e pode diferir em centésimos do total fixo; dinheiro nunca diverge;
- os SUBTOTAL iam sem valor gravado: agora levam o valor sem filtro (`<v>`, em
  aritmética inteira), mantendo `fullCalcOnLoad`.

Decisões de produto registradas, sem bloquear: data do adicional de serviço é a da
execução mesmo quando a competência é outra (só bancos com a 038); o arquivo não
traz aviso de valores previstos nem bloqueia com alerta crítico; no modo acumulado
o ajuste de HE não tem horas; ajuste de colaborador sem diária sai depois dos
demais. Validação: suíte do cliente 105/105, 65/65 suítes, lint, `tsc`, build e
compatibilidade 034 → 045 com 685 asserções e 0 falhas (SUBTOTAL gravado = total =
receita do `GET` em todos os schemas).

**Não usar R$ 35.118,12** como resultado esperado de nenhum conjunto que não seja a
quinzena Dynamis original: essa conciliação é do FIN-PR-13.

## Estado vigente — FIN-PR-11, HML na 045 (05/11/2026)

**Git:** [PR #97](https://github.com/therunnas/bslogistica/pull/97) (WORKFLOW-01)
mergeado por squash em `314c08cb20e9a32dd10b4a0665e1be7dad108264`, condicionado ao
head `3427d1c` com CI verde. CI de `main` no merge (run 42025322827): `validar` e
`sql-local` com sucesso. FIN-PR-12 e FIN-PR-13 não foram iniciados.

**Aplicação:** a Vercel publicou `314c08c` em Production
(`dpl_ALDY5SPhRiWMiHW3qr6xDS3s74hk`, pronto às 12:14:11 UTC), de novo **antes**
da CI de `main` (12:16:36 UTC). O merge alterou só documentação, CI e scripts de
validação; o código de aplicação publicado é o mesmo de `eb8cec9`. O domínio
respondeu 200 com CSP apontando para o Supabase de Production.

**Banco:** HML `qbnfcmrxmssnwkhaitgd` na **045** (`20261112120000`) desde
05/11/2026 13:03 UTC, por aplicação autorizada de 035–045 (sessão 05). Production
`ehkduqokntemtmqzdrbd` continua na 034 (`20261101120000`), sem nenhuma alteração.

**Backup:** `supabase backups list` vazio e PITR desligado em HML e Production.
Em 05/11/2026 (sessão 03) foi gerado backup lógico cifrado do HML na 034 e
restaurado em instância local descartável, com catálogo, ACL, RLS e contagens
iguais ao HML; hash, cobertura e ajustes de restauração em [evidências do HML](#fin-pr-11--evidências-de-backup-restauração-e-migrations-no-hml-05112026).
O último backup lógico de Production continua sendo o de 23/10/2026, anterior à
`025` (ver "Backups de Production" adiante).

**Preview → banco:** pela API da Vercel, `NEXT_PUBLIC_SUPABASE_URL` aponta para o
HML no Preview de todas as branches e no override da branch `staging`, e para
Production no escopo Production. O Preview genérico não tem `service_role` nem
segredo de recuperação; os Containers não dependem deles. Detalhes e limites em
[AMBIENTES.md](AMBIENTES.md#variáveis-por-escopo).

**Risco de implantação:** a 036 troca a regra de HE e sábado para lançamentos
novos ou editados (decisão do proprietário de 30/10/2026), sem recalcular linhas
existentes; a 041 e a 042 nascem desligadas. Implantar 035–045 em Production é
gate próprio, depois da homologação.

**Migrations em HML:** preflight aprovado (projeto, head 034, backup e chave,
concorrência), suíte de compatibilidade 034 → 045 com 665 asserções PASS e dry-run
com exatamente 035–045. As 11 aplicaram em ordem, sem erro. Depois: histórico em
50, linhas e valores financeiros existentes idênticos à linha de base, todas as
31 tabelas de `public` com RLS, papel da RPC operacional preservado, tabelas e
RPCs de Containers presentes e expostas pelo PostgREST, nenhuma ampliação de
privilégio. Nenhum dado foi escrito no HML pelos testes. Detalhes em
[evidências do HML](#fin-pr-11--evidências-de-backup-restauração-e-migrations-no-hml-05112026).

**Containers:** schema disponível no HML; **não homologados**. Os 9 fluxos do
roteiro exigem execução real no navegador, no Preview protegido por SSO.

Próximo gate (revisto pela decisão do usuário de 05/11/2026): concluir FIN-PR-12 e
FIN-PR-13 e então homologar tudo de ponta a ponta, Containers inclusive.

## FIN-PR-11 — evidências de backup, restauração e migrations no HML (05/11/2026)

Registro das sessões 03 a 05, transferido na íntegra do checkpoint do PR #98 quando o
[HANDOFF](HANDOFF.md) passou a ser o do FIN-PR-12. Caminhos locais e chaves do
backup continuam fora do repositório.

### Backup de HML (05/11/2026, 12:26:50 UTC)

- Origem confirmada: `qbnfcmrxmssnwkhaitgd` = `bs-logistica-homologacao`, head 034.
- Conteúdo: papéis do cluster, esquema (`public` e demais schemas do projeto),
  dados de `public`, `auth` e `storage`, e o histórico `supabase_migrations`.
- Pacote cifrado com `age` (chave X25519 gerada para este backup):
  `hml-qbnfcmrxmssnwkhaitgd-034-20261105T122650Z.tar.age`, SHA-256
  `03eccd7042c88e1977246458079b0429af9053b8b547e0d07f637f3009b8ceac`; tar interno
  SHA-256 `33068983313cb1bcc9285b13d61174364a39a9e799fefd19980f7b370e00291a`.
- Cópias em claro foram apagadas após o teste de restauração.

### Guarda do backup (sessão 04, 05/11/2026)

- Arquivo cifrado e `.sha256` na pasta local persistente de backups do projeto,
  já usada para backups anteriores; chave `age` na pasta local de chaves do
  projeto, separada da do arquivo. Ambas no home do usuário, com acesso só do
  dono (0700/0600), fora de pastas temporárias, do repositório e da sincronização
  com iCloud, em disco com FileVault ligado. Caminhos não se registram aqui.
- SHA-256 do arquivo no destino igual ao registrado; chave idêntica byte a byte
  à original.
- Recuperação: o arquivo do destino, decifrado em fluxo com a chave do destino
  (sem gravar em claro), reproduz o SHA-256 do tar interno; o pacote tem os 7
  arquivos esperados e o histórico termina em `20261101120000`. É o mesmo pacote
  restaurado e conferido na sessão 03.
- A cópia de origem em armazenamento temporário não foi apagada.
- Limite: arquivo e chave estão no mesmo computador. Perda ou roubo da máquina
  leva os dois; cópia fora da máquina depende de decisão do usuário.

### Restauração (instância Supabase local descartável, Postgres 17)

Restaurado **a partir do arquivo cifrado**, com hash conferido, e comparado com o
HML ao vivo por consultas somente leitura:

- iguais: 21 tabelas, 21 com RLS, 70 policies, 120 funções, 65 triggers, 6
  extensões, 39 migrations (última 034), 3 usuários e 3 identidades de Auth,
  contagem exata de linhas das 24 tabelas conferidas (97 linhas);
- ACL idênticas por impressão digital: tabelas, colunas, `default privileges` e
  schema `public`. Em funções, só `proteger_ultimo_admin()` difere no texto
  (`NULL` no HML, forma explícita do mesmo padrão na cópia; efeito idêntico);
- papel `bslog_rpc_operacional`: dono de 5 funções, 55 grants por coluna,
  nenhum por tabela, sem `CREATE` em `public`;
- RLS funcional: `authenticated` sem papel lê 0 linhas; `anon` negado por grant;
  o papel da RPC não lê `billed_amount`; `TRUNCATE` igual ao HML.

Ajustes que o procedimento de restauração exige (o dump sozinho não basta):

1. `roles.sql` como `supabase_admin` (grant de plataforma ao Realtime);
2. membership `bslog_rpc_operacional` → `postgres` (não vem no dump de papéis) e
   `CREATE` em `public` ao papel só durante a carga, revogado em seguida;
3. dados com `session_replication_role = replica` (FKs circulares em
   `contract_terms`, `employee_cost_terms`, `operation_terms`);
4. omitir blocos `COPY` vazios de tabelas de Auth que a imagem local não tem
   (31 blocos, todos com zero linhas no HML);
5. revogar os `default privileges` implícitos de `anon`/`authenticated`/
   `service_role` e reaplicar os `GRANT`/`REVOKE` do dump;
6. recriar o event trigger `ensure_rls` (como `postgres`, funcionou na cópia).

Não coberto pelo backup: configuração de Auth (provedores, SMTP, URLs), segredos
e chaves do projeto, `vault` (0 segredos no HML), objetos do Storage (0 no HML),
os outros 6 event triggers de plataforma e a configuração da Vercel. A cópia
local usou imagens do CLI v2.117, com Auth mais antigo que o do HML.

### Aplicação em HML (sessão 05, 05/11/2026)

Preflight, todos aprovados antes de qualquer escrita:

- HML e Production distintos e `ACTIVE_HEALTHY`; link local apontando ao HML;
  HML exatamente na 034, sem migration desconhecida; nenhum processo de
  migration local, nenhuma sessão ativa nem advisory lock no banco;
- backup da guarda local íntegro (SHA-256 igual ao registrado), chave
  disponível e decifragem do tar interno conferida; HML idêntico ao estado do
  backup (linhas, catálogo e ACL);
- `scripts/testar-compatibilidade-deploy.sh` em cópia isolada do código
  (instância local própria, portas exclusivas): **10 cenários, 034 → 045, 665
  asserções PASS, 0 falhas**, com build, páginas de Containers e ausência segura
  da capacidade antes da 045;
- `db push --dry-run`: exatamente 035, 036, 037, 038, 039, 040, 041, 042, 043,
  044, 045; sem seeds nem roles;
- escritas de nível superior nas 035–045: só DDL, catálogo inicial de funções
  (039) e registro único de preços desligado (041); nada recalcula lançamentos,
  adicionais ou faturas existentes.

Aplicação: `db push --linked --project-ref qbnfcmrxmssnwkhaitgd --yes`, sem
`--include-all`, head reconfirmado imediatamente antes. As 11 aplicaram em
ordem, sem erro.

Verificação pós-migration (somente leitura):

- histórico: 50 migrations, última `20261112120000`, nenhuma pendente;
- integridade: linhas das 24 tabelas anteriores iguais; hash de
  `timesheet_entries` (valores, status, horários, `invoice_id`) e de
  `billing_additionals` iguais à linha de base; 4 lançamentos com R$ 328,13
  cobrados e R$ 235,00 de custo; 0 duplicidades; 0 faturas;
- tabelas novas só com os registros previstos: 4 funções no catálogo e 1
  configuração de preços (`tarifas_por_funcao = false`);
- segurança: 31 tabelas em `public`, todas com RLS; 87 policies (43
  restritivas); `anon` sem DML; `TRUNCATE` inalterado; `ensure_rls` ativo;
- papel `bslog_rpc_operacional`: mesmas 5 funções, 55 grants por coluna, nenhum
  por tabela, nenhuma coluna financeira nem de containers, sem `CREATE`;
- paridade com o banco montado só pelas migrations: definições de funções,
  policies, triggers, constraints, colunas e ACL de colunas idênticas; nas ACL
  de tabelas e funções o HML é igual ou **mais restrito** (27 diferenças, todas
  restrições preexistentes), nunca mais amplo;
- Containers: `container_services` (14 constraints, 4 índices),
  `container_service_participants` (4, 2) e `container_service_audit` (3, 2),
  RLS e 2 policies cada, `authenticated` só `SELECT`; RPCs
  `registrar_servico_container(jsonb,uuid,text)` e
  `cancelar_servico_container(uuid,text)` `SECURITY DEFINER`, `search_path`
  fixo, sem `EXECUTE` para `anon`;
- isolamento (transações somente leitura): admin com sessão viva lê os dados;
  usuário sem papel lê 0 linhas e a RPC o recusa (42501); `anon` sem `EXECUTE`;
  o papel da RPC operacional não acessa `container_services`;
- PostgREST do HML já expõe as tabelas e RPCs da 045 (recusa por permissão para
  `anon`, não "inexistente"), que é o sinal usado pelo app para liberar o
  recurso;
- motor por vigência já estava ligado no HML desde 24/10/2026 (teste com dados
  `HML-TESTE`): a regra V2 da 036 vale para lançamentos novos ou editados.

Regras financeiras (diária, HE, adicionais, sábado, domingo, feriado,
fechamento e faturamento) foram exercitadas pela suíte de compatibilidade no
banco local 045, cujas definições são idênticas às do HML; nenhum teste que
escreve dados foi executado no HML.

Riscos: a 036 muda HE e sábado para lançamentos novos ou editados (decisão do
proprietário de 30/10/2026); a 041 e a 042 nascem desligadas; nunca aplicar a
045 isolada. Production é gate separado, depois da homologação.

### Roteiro de homologação de Containers (navegador, Preview → HML)

Pré-requisitos: schema 045 em HML (cumprido); Preview `dpl_7qDuM37uyJBSCgHvH9E7mjVH4yZU`
(`d6f4186`, código de aplicação igual à `main`) construído com destino HML;
conta `admin` de teste e, para o item 1, conta `operacional` de teste aprovadas.
O HML tem 3 contas de Auth, 1 papel atribuído e nenhum fator MFA.

1. Acesso: `admin` vê Containers; `operacional` não abre `/containers`.
2. Registro pelo menu: cliente, operação opcional, data, descrição, quantidade,
   valor total e participantes com valor por pessoa; lista e detalhe conferem.
3. Rateio explícito de um total entre participantes; nunca divisão automática.
4. Atalho no cartão de Operações: cliente e operação preenchidos; URL com
   operação inválida, repetida ou de outro cliente é bloqueada.
5. Idempotência: duplo clique gera um registro; recarregar recupera a intenção.
6. Recusas: quantidade zero, centavos inválidos, soma de participantes divergente.
7. Cancelamento com motivo cancela a receita junto; adicional vinculado não se
   cancela isoladamente; serviço faturado não se cancela.
8. Fatura com diárias e container na mesma operação: adicional uma única vez;
   fatura só com container válida; competência diferente da execução.
9. Custo devido só em visões internas; receita não duplicada; auditoria registra
   registro e cancelamento.

Testes automatizados e o ensaio local não substituem nenhum item acima.

## WORKFLOW-01 — histórico até o merge do PR #97 (05/11/2026)

**Git:** [PR #96](https://github.com/therunnas/bslogistica/pull/96) mergeado por
squash em `eb8cec9af11c4b0e314296ed776caf15c3764b5f`, HEAD de `main` confirmado no
início do WORKFLOW-01. FIN-PR-11A/B/C estão integrados no código. FIN-PR-12 e
FIN-PR-13 não foram iniciados.

**Aplicação:** a integração Git da Vercel publicou o merge do PR #96 em Production.
O deployment Production terminou às 10:50:07 UTC, antes da CI de `main`, que
terminou às 10:51:57 UTC. O PR possuía CI anterior aprovada, mas não houve
homologação real do fluxo de Containers antes da publicação. Merge, deploy do
frontend e disponibilidade do schema são evidências distintas.

**Banco:** consultas remotas somente leitura confirmaram dois projetos Supabase
distintos e saudáveis: Production `ehkduqokntemtmqzdrbd` e HML
`qbnfcmrxmssnwkhaitgd`. Em ambos, a migration remota mais recente é a 034
(`20261101120000`). O Git contém 035–045; a migration 045 e suas dependências não
estão disponíveis remotamente. Nenhuma migration, SQL, flag ou configuração foi
alterada neste diagnóstico.

**Preview/HML:** o Preview do PR #96 concluiu com sucesso e sua URL gerada estava
protegida por Vercel SSO. O destino Supabase efetivo desse Preview e os escopos
nominais das variáveis Vercel não foram comprovados. HML existe como projeto
separado, mas não se presume que todo Preview esteja vinculado a ele nem que seu
Auth/dados sejam adequados para homologação. Nenhum dos projetos Supabase possui
branch de Preview configurada.

**Controles:** `main` estava sem proteção, ruleset ou checks obrigatórios. Os
GitHub Environments `Preview` e `Production` existiam sem protection rules. A
publicação automática de `main` é risco operacional aberto; sua contenção exige
configuração administrativa futura e não faz parte do PR documental.

**Tarefa naquele momento:** WORKFLOW-01, branch `docs/workflow-01`, publicada no
[PR Draft #97](https://github.com/therunnas/bslogistica/pull/97). Os commits
`9926622` e `ae2f319` criaram o processo em
[WORKFLOW.md](WORKFLOW.md), o inventário em [AMBIENTES.md](AMBIENTES.md) e o
checkpoint em [HANDOFF.md](HANDOFF.md), além de controles locais/CI sem secrets.

**Validação local do WORKFLOW-01:** RED do validador com 2/4 casos falhando por
campo obrigatório vazio e link local quebrado; GREEN 4/4. Todos os 64 scripts
Node `test:*`, lint, TypeScript, Prettier, validação de referências e diff check
passaram. O build padrão Turbopack permaneceu bloqueado por `Operation not
permitted` ao abrir porta interna, inclusive fora da sandbox; o build alternativo
Webpack passou. Na CI do HEAD `0e1848a` (run 42019884284), o build padrão, as
suítes Node, o check documental e o job `sql-local` passaram. Nenhum SQL local
ou remoto foi executado por esta etapa.

**Revisão R1 (sessão 02):** acrescentou a transferência entre agentes ao
[WORKFLOW.md](WORKFLOW.md#transferência-entre-agentes) e campos obrigatórios de
continuidade ao HANDOFF, exigidos pelo validador. O HEAD validado vigente fica no
[HANDOFF](HANDOFF.md).

Commit R1 `4e3b0ab` e checkpoint `3427d1c` com CI verde; integrado em `314c08c`.

## FIN-PR-11C — containers na operação existente (histórico do PR #96 em 04/11/2026)

Registro anterior ao merge do [PR #96](https://github.com/therunnas/bslogistica/pull/96),
que naquele checkpoint estava **Draft e não mergeado**, na branch
`feat/fin-pr-11c-interface-containers`, checkout
`/private/tmp/bs-fin-pr-11c`. HEAD de entrada confirmado com working tree limpa:
`bb9ec2c96cdb653edfbfef2cffcecb6ed0a4ae72`; base main preservada:
`10bcfd83a42409c477a7df584cca279a1368f216`. O HEAD publicado deste incremento
é o commit que contém esta seção, a conferir no Git/PR com seus próprios checks.

**Decisão operacional:** uma mesma operação pode conter diárias, HE e serviços
avulsos de containers. Container continua sendo serviço avulso, com receita
negociada e custos explícitos, sem virar diária/HE. Não se cria outra operação
nem contrato específico para registrar o serviço. O menu Containers permanece
como visão geral dos serviços; Faturamento, Fechamento e Relatórios continuam
separados.

**Compatibilidade comprovada por inspeção:** a RPC 045
`registrar_servico_container` já recebe `operacaoId`, preserva-o em
`container_services` e encaminha a receita única para `registrar_adicional`
(assinatura vigente da 038). Essa função valida no banco que a operação pertence
ao cliente; não exige contrato específico. `gerar_fatura` da 045 conserva o
vínculo da operação no item e fatura o adicional uma única vez. A suíte SQL 045
já possui operação sem contrato (`MISTA-045`), com diária existente e container
na mesma fatura, total exato, snapshot OFF preservado e sem dupla cobrança.
Não houve bloqueio estrutural nem mudança de schema/RPC/RLS/regra financeira.

**Fluxo anterior:** acesso pelo menu geral Containers e seleção manual de cliente
e operação no formulário. **Fluxo novo:** cada cartão em Operações oferece
“Adicionar serviço de container”, apontando para `/containers/novo?operacao=<uuid>`.
A rota preserva `exigirAdmin()` e reutiliza o mesmo formulário. A operação e o
cliente são resolvidos pelo catálogo retornado pela Action administrativa;
nenhum cliente é aceito da URL como autoridade. Após preencher os demais dados,
o registro usa a mesma Action/RPC e a consulta existente exibe o vínculo persistido.
Não há chamada de criação de operação ou de contrato nesse atalho.

**Proteções do contexto:** valor ausente conserva o formulário genérico. Operação
inválida, parâmetro repetido/ambíguo, entidade ausente ou cliente fora do catálogo
bloqueiam o cadastro, sem fallback genérico silencioso. Uma intenção preservada
tem prioridade sobre o atalho: não se aplica outro cliente/operação, a chave é
mantida e um aviso explícito aparece tanto na pendência quanto na recuperação de
serviço confirmado. A chave React da página muda com o contexto para evitar
reaproveitar estado de formulário de outra origem. Correção antes do primeiro
envio permanece permitida; resultados incertos exigem reconciliação. Ausência
real da 045 continua bloqueando o recurso, sem migration automática.

**TDD e regressões executadas:** RED antes da implementação com **47/54 testes
de tela PASS e 7 FAIL**, por atalho ausente, contexto não transmitido/preenchido,
falta de recusa para URLs inválidas e ausência do aviso sobre intenção anterior.
GREEN focal: **57/57 telas**, **23/23 dados/Actions** e **8/8 adaptador**, incluindo
preenchimento real, guarda da rota, duplo clique com uma única chamada, consulta
com operação/receita consistentes, contexto inválido, cliente ausente, intenção
pendente/confirmada e capacidade 045 ausente. **63 suítes Node PASS**, incluindo
regressões de autorização/MFA, idempotência, reconciliação, faturamento e
adicionais. Os testes executam componentes/funções reais com fronteiras simuladas;
o atalho no cartão também tem asserção estrutural. Não são E2E em navegador real.

Lint, TypeScript e Prettier passaram. A primeira checagem de tipos identificou
o contrato PageProps do Next e a prop opcional explicitamente indefinida; ambos
foram corrigidos mantendo `exactOptionalPropertyTypes`, sem relaxar validações.
O build padrão local continua impedido de abrir a porta do Turbopack
(`Operation not permitted`), mesmo com exceção específica. Build local
alternativo `npm run build -- --webpack` **PASS**, com variáveis públicas inertes
da CI e exceção para fontes públicas. O build padrão da CI deve ser conferido
no novo SHA como evidência distinta. Não houve mudança de configuração para
mascarar a restrição ambiental.

**Ambientes e continuidade naquele checkpoint:** migrations 001–045,
domínio/adaptador, RPCs, RLS,
grants, faturamento e dependências foram preservados; mudaram somente o atalho,
a rota/formulário, três suítes e estes dois documentos. Não houve SQL/reset local,
migration remota, alteração de flags/credenciais/ambientes ou deploy manual.
Aplicação remota da 045 continua sem comprovação. CI `validar`/`sql-local` e Vercel
devem ser conferidos no novo SHA, incluindo a prova SQL existente da fatura mista.
Permanecem as limitações de storage/recuperação documentadas abaixo. Próximo gate:
revisão independente deste incremento e decisão específica de integração do
PR #96, mantido Draft; E2E real e homologação não foram declarados. FIN-PR-12/13
não foram iniciados.

## FIN-PR-11C.5 — isolamento de falhas de armazenamento e logout (04/11/2026)

Continuação do [PR #96](https://github.com/therunnas/bslogistica/pull/96), ainda
**Draft, não mergeado**, na branch `feat/fin-pr-11c-interface-containers`, checkout
`/private/tmp/bs-fin-pr-11c`. HEAD de referência confirmado antes de editar:
`2d02509093d90803c02483588bec1117ca610432`, com working tree limpa e remote
`therunnas/bslogistica`. Base main preservada: `10bcfd83a42409c477a7df584cca279a1368f216`.
O novo HEAD é o commit que publica este checkpoint e as correções abaixo; deve
ser conferido no Git/PR, junto aos checks desse SHA. Os registros C.3/C.1 abaixo
preservam o histórico anterior, não o tratamento atual de falhas do AppShell.

**Dois P2 comprovados na revisão C.4:** uma exceção do getter `sessionStorage`
acionava o bloqueio global de confidencialidade, ocultando qualquer módulo de
uma sessão válida, inclusive Operacional. Além disso, uma falha de saneamento
na saída lançava exceção antes do aviso entre abas e encontrava um `return`
no AppShell: a Action `sair()` não era chamada.

**Correção de disponibilidade:** o observador de privacidade captura a recusa de
storage e informa capacidade local indisponível, sem interpretar isso como
mudança de sessão. O canal entre abas é opcional; falha ao criá-lo não invalida
papel ou acesso. Dashboard, Apontamentos, Faturamento e Operacional permanecem
no fluxo normal com autorização server-side existente. O cadastro de containers
continua bloqueado no próprio formulário quando não consegue sanear/ler a
intenção, com mensagem específica de armazenamento; não há fallback para outro
storage nem persistência do payload financeiro. A mudança no Provider é apenas
a correção do comentário que descrevia o antigo bloqueio global.

**Correção de logout:** o conteúdo sensível é retirado e o cache limpo antes da
resposta do servidor. A falha local é apresentada separadamente da falha de
`signOut()`, sem retorno antecipado que impeça a Action. O observador tenta
notificar outras abas em `finally`, mesmo quando o saneamento falha. Eventos de
saída/troca de identidade continuam ocultando o conteúdo e limpando cache,
independentemente da capacidade de storage. A verificação do erro real de
`signOut()` da C.3 foi preservada: falha não anuncia saída concluída.

**Controles anteriores preservados:** no navegador continuam persistidos somente
UUID do usuário/chave e versão do marcador. Lote, motivo, receita e custos
permanecem em memória. Não se apagam marcadores para contornar uma falha de
leitura; intenção incerta/recarregada não autoriza novo payload ou chave sem
reconciliação. Correção de cliente antes do primeiro envio, limpeza da operação,
nova chave para outro cliente e guardas administrativas das Actions permanecem
cobertas pelas suítes existentes. Domínio, faturamento, RPCs, RLS, MFA e migrations
001–045 não foram modificados; nenhuma dependência foi adicionada.

**RED executado antes de corrigir:** suíte de telas com **38/45 PASS, 7 FAIL**:
quatro módulos ocultos com getter recusado; mensagem genérica em vez de erro de
storage no formulário; duas saídas com **zero chamadas** da Action, quando era
esperada uma. Suíte de intenção com **21/22 PASS, 1 FAIL**: falha de leitura
interrompia a invalidação de outra aba. Não foram falhas de conexão ou de runner.

**GREEN/regressões locais:** **63 suítes Node PASS**, incluindo **47 testes de
telas, 22 de intenção/privacidade, 22 de dados/Actions e 2 de integração**.
Cobertos storage disponível, getter `SecurityError`, leitura recusada após
montagem, logout com falha/sucesso de servidor, demais módulos para admin e
operacional, troca de identidade com storage recusado, aviso entre abas mesmo
com saneamento falho, saneamento legado, payload nunca persistido, intenção
incerta, correção de cliente e autorização. Funções e componentes TSX reais,
com fronteiras de Auth/rede/navegador simuladas; não são E2E em navegador real.
Lint, `tsc --noEmit --incremental false`, Prettier dos arquivos alterados e
`git diff --check` passaram. O build padrão local voltou a falhar por
`Operation not permitted` ao abrir a porta interna do Turbopack, apesar da
exceção específica; isso não foi declarado PASS nem motivou mudança de config.
O build local alternativo `npm run build -- --webpack` **PASS**, com variáveis
públicas inertes da CI e exceção específica para fontes públicas. O build padrão
automático da CI deve ser conferido no novo SHA, sem confundir as duas provas.

**Limites e ambientes:** não houve SQL/reset local, migration remota, deploy
manual, alteração de Preview/HML/Production, flags, credenciais ou dados reais.
A aplicação remota da 045 continua sem comprovação. CI `validar`/`sql-local` e
Vercel devem ser conferidos no novo SHA; sucesso anterior não é aprovação da C.5.
Se o navegador recusar acesso/escrita, o aplicativo não pode garantir que um
envelope legado já existente tenha sido saneado: mantém aviso e bloqueio local
de cadastro, sem descartar o marcador nem prometer limpeza concluída. Abas com
código antigo/suspensas ainda dependem de receber invalidação ou recarregar.
A impossibilidade de reconstituir payload volátil após reload permanece documentada
na C.3; não é resolvida criando nova intenção automaticamente.

**Próximo gate:** revisão independente do novo HEAD com CI e Vercel confirmados,
mantendo o PR Draft. Integração depende de autorização específica. Nenhum merge,
Ready for Review ou FIN-PR-12/13 foi iniciado.

## FIN-PR-11C.3 — correções de privacidade e cliente (04/11/2026)

Continuação do [PR #96](https://github.com/therunnas/bslogistica/pull/96), ainda
**Draft, não mergeado**, na branch `feat/fin-pr-11c-interface-containers`, checkout
`/private/tmp/bs-fin-pr-11c`. HEAD revisado antes das correções:
`05625a92e59db4a5cd3e9c2bc0e4fa13034de5e2`; base main preservada:
`10bcfd83a42409c477a7df584cca279a1368f216`. Working tree estava limpa no preflight.
O checkpoint C.1 abaixo descreve a implementação anterior: seu contrato de
persistência financeira foi substituído pela correção P1 desta seção.

**P1 — confidencialidade e recuperação:** lote, payload canônico, motivo, receita
e custos ficam somente na memória da tela. `sessionStorage` persiste apenas
`versao: 2`, UUID do usuário e chave UUID da intenção, nunca tokens/credenciais.
Separar chaves por usuário continua útil, mas não é tratado como proteção do
conteúdo. Envelopes antigos de todas as identidades são reduzidos a marcadores;
conteúdo corrompido sem chave recuperável vira bloqueio persistente, sem gerar
outra intenção. O saneamento ocorre também no provider inicial, inclusive no login.

Ao iniciar logout, o AppShell retira o conteúdo financeiro e limpa o cache antes
da resposta do servidor. Falha de logout mantém o conteúdo oculto e informa que a
saída não foi confirmada. A Action também verifica o campo `error` retornado por
`signOut()` antes de redirecionar: o RED adicional demonstrou que antes o erro
resolvido pelo SDK era ignorado. O redirecionamento de sucesso foi preservado.
Um canal entre abas transmite somente invalidação;
eventos de saída/troca de conta do SDK também retiram o conteúdo. Isso **não é
nova decisão de autorização**: páginas/Actions continuam nos guards existentes,
com MFA opcional e RLS. Sem BroadcastChannel, a proteção local e os marcadores
sem valores permanecem; não se promete apagar a memória de outra aba suspensa
ou com código antigo antes que ela receba o evento ou seja recarregada.

**Limitação deliberada:** após recarregamento/logout, o payload volátil não pode
ser reconstituído do storage. A nova Action administrativa de **leitura**
`recuperarMarcadorContainerAction` consulta a chave no backend e só devolve
`ausente` ou o UUID do serviço confirmado; ambiguidade é recusada. Não escreve
em tabelas nem cria RPC/migration. Serviço confirmado abre seu detalhe. Se estiver
ausente, houver erro ou leitura inconsistente, a tela conserva o marcador,
mostra a chave para reconciliação administrativa e bloqueia edição/reenvio/nova
chave, inclusive depois de uma leitura de ausência. Não há descarte automático.
Enquanto a tela original continua aberta, timeout/retry preservam o mesmo payload
e a mesma chave e exigem reconciliação antes de repetir. Fechar a aba ou limpar
manualmente o armazenamento ainda pode perder o marcador; essa ação não é um
procedimento seguro para resolver uma intenção de resultado incerto.

**P2 — cliente antes do envio:** após revisar e voltar para corrigir uma intenção
preparada, o cliente pode ser alterado. A operação anterior é limpa; o rascunho
comprovadamente não enviado é liberado e a próxima revisão cria outra chave para
o novo cliente. Alterações no mesmo cliente preservam a chave original. Domínio,
soma de custos e vínculo cliente/operação são revalidados pelos contratos
existentes. Intenção enviada/indeterminada nunca libera cliente ou payload.

**Evidências locais executadas:** RED P1 com 17/18 testes passando, falhando porque
o JSON continha lote/motivo/receita/custos; RED P2 com 27/28 passando, falhando
porque o seletor de cliente permanecia desabilitado antes de qualquer envio.
GREEN final: **63 suítes Node PASS**, incluindo **22 testes de dados/Actions,
21 de intenção/privacidade, 33 de telas e 2 de integração**. Cobertos logout com
falha, evento de saída, troca de conta, aviso entre abas, ausência de canal,
saneamento legado/corrupção, storage indisponível, reload bloqueado, reconciliação
confirmada, timeout após commit, retry estável, correção de cliente/operação,
autorização e cancelamento financeiro. São funções e handlers TSX reais com
fronteiras de navegador/rede/Supabase simuladas, não E2E em navegador ou banco.

Lint, TypeScript e Prettier dos arquivos alterados passaram. A primeira rodada
completa encontrou a asserção literal G8 de `test:papel` pela referência direta a
storage no AppShell. O acesso foi concentrado no módulo de privacidade; a
asserção original foi preservada e a rodada completa seguinte passou. O build
padrão Turbopack foi impedido de abrir porta local (`Operation not permitted`),
mesmo na tentativa com exceção específica. Build alternativo **webpack PASS**
com variáveis públicas inertes da CI, após exceção de rede para fontes públicas;
a tentativa inicial restrita havia falhado por DNS. Sem alteração de configuração
para mascarar essas limitações. Build padrão e SQL da CI devem ser conferidos
no **novo SHA**, sem transferir o sucesso do HEAD anterior para esta correção.

**Escopo:** intenção/privacidade, formulário, leitura/Action do marcador,
AppShell/provider, três suítes de regressão e os dois documentos de continuidade.
Migrations 001–045, RPCs, RLS/grants, domínio/adaptador, regras monetárias e corpo
de faturamento não foram alterados. Não houve SQL/reset local nesta correção,
migration remota, deploy manual, alteração de ambientes, flags ou dados reais.
A 045 continua apenas versionada/testada localmente conforme as evidências
anteriores; sua aplicação em Preview, HML ou Production não é presumida.

**Próximo gate:** conferir CI e Vercel do commit publicado, mantendo o PR Draft,
e obter nova revisão independente das correções. Merge depende de autorização
específica. Homologação real e E2E visual continuam pendentes; FIN-PR-12/13 não
foram iniciados. Em eventual reversão de aplicativo, não restaurar a persistência
do payload financeiro do HEAD anterior; o marcador não é uma intenção reenviável.

## FIN-PR-11C.1 — interface administrativa de containers (04/11/2026)

**Base comprovada:** [PR #95](https://github.com/therunnas/bslogistica/pull/95)
mergeado por squash em `10bcfd83a42409c477a7df584cca279a1368f216`, main remota
confirmada no início desta etapa. O checkout FIN-PR-11B foi preservado limpo;
implementação em `/private/tmp/bs-fin-pr-11c`, branch
`feat/fin-pr-11c-interface-containers`, criada diretamente dessa main.
Commit da implementação e testes: `91befbd13bd23eeaf81e97ba68b9971a673ef630`;
o checkpoint documental fica no commit seguinte. A main foi reconferida na base
antes da publicação; resultados de CI remota devem ser conferidos no HEAD do PR.
Os checkpoints anteriores abaixo preservam os estados anteriores ao merge.

**Escopo implementado localmente:** `/containers`, `/containers/novo` e
`/containers/[id]`, com guarda administrativa server-side, listagem filtrada e
ordenada, revisão antes de cadastrar, participantes/custos explícitos, competência
opcional, detalhes persistidos, auditoria e cancelamento confirmado. Navegação
administrativa e acesso contextual pelo Faturamento; nenhum acesso financeiro
acrescentado ao operacional. Reutilizados domínio e adaptador FIN-PR-11A/B,
`registrar_servico_container` e `cancelar_servico_container`, sem escrita direta
nem nova fonte de receita/custo. Custo devido continua diferente de quitação.

As Server Actions delegam a `exigirAdminAtor()` antes de consultar dados e usam
`criarClienteServidor()` com cookies da sessão, sem service_role. MFA permanece
opcional: admin sem fator trabalha em AAL1; fator verificado exige login AAL2.
RLS, RPCs, grants e regras monetárias continuam sendo autoridade do banco.
Todas as migrations, inclusive 045, foram preservadas byte a byte com a base.

**Leituras:** DTOs explícitos, campos mínimos, conferência de lastro/centavos,
contagem e cursor estável; participantes paginados por `employee_id` no serviço,
pois não têm `id`. Auditoria apresentada sem payloads internos ou identificadores
de sessão. Schema ausente, autorização, rede e inconsistência recebem respostas
distintas. Ausência comprovada da tabela 045 conserva o fluxo legado de
adicionais; erro de rede, RPC/coluna ausente ou leitura parcial não prova que um
adicional seja legado. Não há fallback de container para adicional genérico nem
execução automática de migration.

**Intenção e recuperação:** `sessionStorage` preserva usuário, cliente, UUID,
payload canônico, motivo e estado antes da escrita; não armazena tokens ou
credenciais. A identidade atual é confirmada no servidor antes de recuperar ou
reenviar. Erro/corrupção de storage bloqueia envio sem descartar a intenção.
Duplo clique possui trava síncrona; timeout mantém chave/payload. Recarregamento
exige reconciliação no backend; resultado incerto nunca cria nova chave.
Rejeição explícita de validação/entidade inexistente na primeira tentativa pode
ser corrigida após ausência confirmada, mantendo **cliente e chave**. Intenção
anteriormente indeterminada permanece bloqueada para edição. Uma nova chave não
permite inferir duplicidade física entre pedidos distintos, limite já existente.

**Correções da revisão local:** foram reproduzidos e corrigidos dois P2: formulário
preso após rejeição definitiva de competência e mapa financeiro desatualizado
oferecendo cancelamento genérico. O formulário agora distingue recusa de resposta
incerta. Faturamento confirma vínculo fresco tanto antes de abrir como antes de
confirmar cancelamento; container encaminha ao detalhe, falha bloqueia e somente
adicional legado comprovado usa a RPC genérica existente. UUIDs são normalizados
na comparação canônica sem alterar caixa de textos comerciais. A revisão final
independente do HEAD publicado continua sendo o próximo gate.

**Arquivos:** novas rotas/componentes e `_acoes.ts` em
`src/app/(painel)/containers/`; módulos `container-servico-dados.ts`,
`container-servico-servidor.ts`, `container-servico-intencao.ts` e
`container-servico-ui.ts`; quatro suítes `test-container-{dados,integracao,intencao,telas}.mjs`,
runner `testar-container-leitura-local.py`, navegação e adicionais de Faturamento.
Package/CI incluem as novas suítes; runner de compatibilidade inclui a 045.
Inventários de testes reconhecem o novo link administrativo, guard de página e
décimo cenário, preservando os cenários antigos e restrições do operacional.

**Evidências executadas:** RED real por módulos/rotas ausentes antes da
implementação; RED adicionais para corrupção/transições de intenção, reconciliação
de UUID, rejeição definitiva e erros de capacidade. GREEN em **63 scripts Node**,
incluindo **21 testes de dados/Actions, 17 de intenção, 27 de telas e 2 de integração**;
23 do domínio e 7 do adaptador anteriores preservados. Os testes de telas executam
handlers TSX reais com fronteiras de rede/navegador simuladas; não são E2E visual.
Lint, TypeScript e AST Python aprovados. Formatação e diff check são conferidos
antes da publicação.

**Banco local:** nova instância exclusiva `/private/tmp/bs-fin11-local-c1pl1vue11`,
project_id correspondente, portas 56220–56229 conferidas, labels, volume e rede
próprios, sem referência remota. Nenhum container/volume anterior reutilizado ou
removido. A suíte SQL 045 foi realmente executada (**88 asserções PASS**) com
fixtures sintéticas; a leitura real pela API comprovou quatro serviços,
participantes, auditoria, lastro e reconciliação sob RLS para admin AAL1 sem fator.
O runner de leitura não grava nem reseta banco e mantém JWT/credenciais locais
apenas em memória. A preparação de fixtures foi exclusiva desse projeto.

Compatibilidade final **034, 037, 038, 039, 040, 041, 042, 043, 044 e 045 PASS**:
**665 asserções**, incluindo capacidade, páginas administrativas autenticadas e
conferência fresca do vínculo legado, sem RPC de escrita de container nos bancos
anteriores à 045. O build com o código final e o Supabase local passou nessa
rodada; o build separado com variáveis inertes também passou. Prettier nos
formatos suportados e `git diff --check` aprovados.

A primeira CI do PR da interface (run `41920379242`, HEAD `c817f10`) passou no
job SQL, mas o job Node encontrou uma corrida na limpeza do teste antigo de
streaming de logs: `terminate()` seguido de espera de 2 s competia com a
finalização do filho no Linux. O teste passou a liberar o filho por stdin
somente depois de observar seu log e comprovar que ainda estava ativo, sem
alterar o helper de execução ou retirar testes de deadline. As **15 verificações
do runner passaram localmente**, com lint/Prettier/diff check. CI final deve ser
conferida no HEAD posterior desse ajuste; sucesso anterior não é transferido
automaticamente a outro SHA.

**Limites:** nenhuma migration aplicada ou flag alterada em banco remoto;
Não houve intervenção administrativa em Preview, HML ou Production; o destino
dos seus bancos não foi validado nesta etapa. Código no Git, eventuais checks
automáticos de Preview e schema implantado são evidências diferentes. Não houve
homologação com dados reais nem E2E visual em navegador real. Storage de negócio
é acessível ao JavaScript da origem: não autentica conteúdo, pode ser perdido ao
encerrar a aba/limpar o navegador e não substitui a idempotência/autorização do
banco. Resposta sem confirmação permanece bloqueada para reconciliação.

**Continuidade:** logs fora do Git em `/private/tmp/fin11c-*.log`; fixtures e
runners versionados permitem repetir testes em outro ambiente descartável.
Próximo gate: PR Draft contra main, CI do HEAD e revisão independente; merge
depende de autorização específica. Nenhuma migration nova foi criada e nenhuma
regra de diária, HE, bônus, feriado, tarifa ou faturamento foi modificada.
FIN-PR-12 e FIN-PR-13 não foram iniciados.

## FIN-PR-11B — checkpoint de desenvolvimento local (04/11/2026)

Registro histórico anterior à integração do PR #95; o merge comprovado está no
checkpoint FIN-PR-11C.1 acima. As referências a Draft/merge pendente abaixo
descrevem seus respectivos momentos, não o estado atual do PR #95.

### FIN-PR-11B.R2 — fechamento documental da R1 (04/11/2026)

**Estado técnico:** FIN-PR-11B validado, sem pendência técnica conhecida neste
escopo, aguardando decisão de integração. O [PR #95](https://github.com/therunnas/bslogistica/pull/95)
continua **Draft e não mergeado**. HEAD técnico validado:
`74720841c1efaf65415e705977cfc0dfdbd43493`, na branch
`feat/fin-pr-11b-backend-containers`. A R2 altera somente este documento e
`PROGRESS.md`; não modifica o conteúdo técnico revisado. O parecer e a CI abaixo
se referem ao SHA técnico, não automaticamente ao commit documental posterior.

**Fechamento local comprovado, separado da CI:** o runner existente
`scripts/testar-container-paridade-local.py` concluiu com saída zero usando a
mesma instância descartável `bs-fin11-local-3fi66bvw`. Project_id, portas,
labels, volume e rede exclusivos foram reconferidos; não houve referência
remota nem alteração de recursos de outros projetos.

- Paridade OFF completa **044×045 PASS, igualdade exata** de valores, minutos,
  fontes, snapshots, itens/faturas e auditoria: instalação sobre históricos e
  repetição das operações em banco limpo. Os JSON `off-044.json` e `off-045.json`
  foram novamente comparados, sem tolerância monetária.
- Rollback sem histórico: **PASS**, restauração exata do catálogo 044 e dados/
  auditoria preservados. Rollback com histórico: **recusa `55000`**, mantendo
  catálogo, serviços, receita, custos, faturas e auditoria idênticos ao estado
  anterior à tentativa.
- Após a recusa permaneceram **4 serviços, 8 participantes, 4 receitas,
  3 faturas e 5 eventos de auditoria**, todos sintéticos; custos individuais
  somados em **12012 centavos**. A suíte 045 executada como fixture transacional
  pelo runner registrou **88 asserções PASS**.
- As quatro provas NOWAIT da R1 já registradas abaixo retornaram `55P03` com
  escritor ativo em `billing_additionals` e nas três tabelas novas, sem DROP e
  sem alteração de catálogo/dados. A cobertura do teste foi conferida no
  fechamento, sem repetir provas suficientes.

Evidências locais preservadas em
`/private/tmp/fin11-r1-evidencias-fechamento/`: `SHA256SUMS` conferido, logs de
paridade/rollback, catálogos 044/045, diferenças esperadas, snapshots OFF e
contagens do histórico. O log NOWAIT está em
`/private/tmp/fin11-r1-green-final.log`. Esses arquivos ficam fora do Git e não
são garantidos em outro computador; os runners e fixtures versionados permitem
reprodução em instância local exclusiva.

**Dificuldades ambientais preservadas:** os dois timeouts de 300 s da rodada
inicial e os bloqueios de porta/DNS do build local realmente ocorreram. No
fechamento, PostgreSQL/portas/CLI responderam e a execução controlada completou
recriação, inicialização e migrations, sem mudar configurações nem substituir a
instância. O bloqueio anterior foi localizado antes das migrations da aplicação;
os logs antigos não permitem atribuir sua causa raiz com segurança. Isso não
constitui falha financeira nem permanece como prova local pendente. As 46 suítes
SQL e o build local não foram repetidos no fechamento; seus resultados remotos
no HEAD R1 são evidências distintas.

**Confirmação remota no SHA `74720841`:**

- [CI run 41897151814](https://github.com/therunnas/bslogistica/actions/runs/41897151814):
  **SUCCESS**; jobs `validar` e `sql-local` **SUCCESS**, incluindo o passo Build.
  Vercel **SUCCESS** no mesmo SHA; esse check não comprova schema/flags remotos.
- [Revisão independente Codex](https://github.com/therunnas/bslogistica/pull/95#issuecomment-6640415665)
  concluída no HEAD R1, sem novos achados; o resumo registra `completed`,
  `has_any_findings=false` e `has_unresolved_findings=false` para o SHA completo.
  A [discussão P2](https://github.com/therunnas/bslogistica/pull/95#discussion_r4469985142)
  está resolvida no GitHub. Não foi solicitada revisão duplicada.
- CodeRabbit informou que o Draft não recebeu revisão substantiva. Seu check
  SUCCESS **não é parecer técnico**.

**Limites e próximo gate:** migration 045 somente versionada/testada localmente
(também no banco efêmero da CI), sem aplicação remota comprovada ou autorizada.
Nenhuma afirmação de implantação do backend em Preview, HML ou Production;
nenhuma flag ativada nem dados reais carregados. Permanecem os limites comerciais
e de rollback do contrato: custo devido não é quitação, idempotência exige a
mesma chave e rollback 045→044 só é permitido antes de uso, sem concorrência.
Próximo gate: avaliação final e **autorização específica de merge** do PR #95;
somente depois, planejamento do FIN-PR-11C mediante autorização. FIN-PR-11C
continua não iniciado. Não houve merge nem Ready for Review nesta etapa.

### FIN-PR-11B.R1 — registro histórico do P2 (04/11/2026)

Partida: `978c116e7e6aab9ecb7b85a08728b831f5813737`, branch
`feat/fin-pr-11b-backend-containers`, worktree limpa. A revisão independente
identificou que o DROP TRIGGER poderia aguardar em `billing_additionals`.
O rollback agora trava essa tabela primeiro, seguida das três tabelas novas,
com `ACCESS EXCLUSIVE NOWAIT` antes das guardas. Nenhuma aquisição espera por
outra transação; conflito aborta imediatamente e desfaz as travas já adquiridas.
Corpo financeiro de `gerar_fatura`, migration 045, RPCs e RLS não foram alterados.

RED real: sessão com ROW EXCLUSIVE confirmada em `billing_additionals`; o prefixo
antigo retornou sucesso em 0,096 s, violando a expectativa de `55P03`. Nenhum DROP
foi executado nessa prova. GREEN com o escritor ainda ativo: `55P03` em
`billing_additionals` (0,095 s), `container_service_audit` (0,105 s),
`container_service_participants` (0,447 s) e `container_services` (0,194 s).
Catálogo e dados permaneceram iguais nos quatro casos. O teste limita o SQL a
2 s e o processo a 10 s, separando a inspeção Docker da medição; uma rodada
intermediária detectou atraso da inspeção, sem falha da recusa SQL.

Regressões R1 executadas: 59 scripts Node, lint, TypeScript, AST Python,
Prettier Markdown e diff check aprovados. Rollback permitido restaurou catálogo
exato 044 e preservou dados/auditoria. Os ensaios usaram exclusivamente o projeto
descartável `bs-fin11-local-3fi66bvw`, com labels/volume/rede reconferidos.

**Limitações da rodada inicial (registro histórico):** o reset seguinte excedeu
300 s; uma tentativa com o
binário 2.117.0 já instalado, sem resolução npm, também excedeu 300 s. O Postgres
aceita conexões, mas sem `public.clients` nem catálogo de migrations. Não houve
outra tentativa nem intervenção em recursos de outros projetos. A repetição da
paridade OFF completa, do rollback bloqueado com histórico e das suítes SQL R1
ficou pendente; seus PASS no checkpoint original abaixo são históricos.
Build local Turbopack bloqueado ao abrir porta (`EPERM`), inclusive após exceção
específica; Webpack bloqueado por DNS de `fonts.googleapis.com` e encerrado.
Não interpretar essas falhas ambientais como testes aprovados. Logs R1:
`/private/tmp/fin11-r1-*.log`, fora do Git.

Naquele checkpoint, o PR #95 permanecia Draft e a validação R1 estava incompleta:
faltavam conferir a CI, recuperar o ambiente descartável e concluir os ensaios
e a revisão independente. Essas pendências foram encerradas no fechamento acima.
Rollback continua restrito a 045→044 antes de uso, sem concorrência; histórico
deve recusar com `55000`,
sem remoção de serviços/auditoria. Nenhum banco remoto, Preview, HML ou Production
foi acessado/alterado, e FIN-PR-11C não foi iniciado.

### Checkpoint original da implementação

Git confirmado nesta execução: desenho FIN-PR-11/PR #93 integrado em
`cc5405b8cd2e6203ba2d4190aaa3b88f463595a2`; domínio puro FIN-PR-11A/PR #94
integrado em `cebf80e3a1c9b74e47d6f5c0e43255d9fa3489c4`, base desta implementação.
Branch isolada: `feat/fin-pr-11b-backend-containers`. Commit do backend e testes:
`7acfbe9b7cb44ca82a785d9018e509bddc627c4e`; a continuidade documental é registrada
no commit seguinte. Escopo implementado e validado localmente, aguardando revisão
independente em PR Draft; não homologado nem integrado à main neste checkpoint.

A migration nova `20261112120000_045_container_servico.sql` foi aplicada somente
no Supabase local descartável. Separa execução, participantes/custos devidos e
auditoria, vinculando uma única receita a `billing_additionals`. As RPCs
`registrar_servico_container(jsonb,uuid,text)` e
`cancelar_servico_container(uuid,text)` revalidam admin, sessão e piso MFA atual,
com escrita direta vedada, RLS, motivos, auditoria e trava transacional por
cliente. `gerar_fatura` mantém o fluxo existente e acrescenta apenas o custo
devido dos containers dos mesmos adicionais selecionados. Diárias, HE, bônus e
faturas existentes preservam suas regras. Não há preço fixo, rateio automático
ou registro de pagamento quitado. Detalhes no
[contrato do backend](financeiro/container-servico-avulso.md#contrato-do-backend-fin-pr-11b).

**Evidências executadas nesta sessão:**

- RED SQL real até a 044: ausência de
  `registrar_servico_container(jsonb,uuid,text)`; execução chegou ao banco, sem
  erro de infraestrutura. Adaptador também teve RED antes da implementação.
- GREEN: todas as **46 suítes SQL**, incluindo **88 asserções da 045**, em banco
  limpo; todos os **59 scripts Node `test:*`**, com sete testes do adaptador e
  23 do domínio integrado. Lint, `tsc --noEmit`, Prettier nos formatos suportados,
  build e `git diff --check` passaram.
- Três provas com sessões PostgreSQL concorrentes: retry da mesma chave gera
  somente um serviço/receita/trilha; cancelamento vencedor impede fatura vazia;
  faturamento vencedor impede cancelamento, preservando receita e custo.
- Matriz de ambas as RPCs: admin AAL1 sem fator e admin AAL2 com fator permitidos;
  MFA pendente, operacional, sem papel, anon e sessão inválida recusados. Testes
  de DML direto, atomicidade após erro intermediário, fatura só de containers,
  fatura mista, competência distinta e imutabilidade passaram.
- Paridade OFF **044×045 exata**, antes/depois da instalação e repetindo as
  operações: valores, minutos, fontes, snapshots, itens/faturas e auditoria
  preservados. Normalização restrita a IDs técnicos e timestamps voláteis.
- Catálogo: somente três tabelas, suas constraints/índices/triggers/policies,
  cinco funções novas, guarda de cancelamento do adicional e o delta de custo
  em `gerar_fatura`. Owner, ACL, security_definer e config anteriores preservados.
- Compatibilidade do app com **034, 037, 038, 039, 040, 041, 042, 043 e 044**:
  **541 asserções**, sem falhas. O backend novo foi testado no schema 045; telas
  de containers não fazem parte desta etapa.
- Rollback antes do uso restaurou catálogo exato 044 e preservou os dados.
  Após uso, recusou com `55000`, sem mudar catálogo, serviços, faturas ou trilha.
  Revisão estática identificou uma janela concorrente no rollback: corrigida
  com `ACCESS EXCLUSIVE NOWAIT` antes da guarda e comprovada por RED/GREEN real
  com `55P03` nas três tabelas. A revisão da correção não encontrou outro bloqueio
  concreto nesse escopo; não substitui a revisão independente do PR.

Os inventários das suítes 010/015 receberam somente os três objetos e seis
policies novos, conservando os inventários antigos. O pin da suíte 035 para
`gerar_fatura` mudou de `6fdfcdaf72100fb7db4bc381a2230e41` para
`b7ddafbd6b0276f99ebf8eac8147a50a`: a comparação de catálogo exige o delta exato
de custo avulso, sem alteração de oráculos monetários. Falhas intermediárias
de inventário e contaminação por fixtures foram corrigidas por inventário
explícito e nova execução em banco limpo, sem tolerância financeira.

**Reprodução e isolamento:** checkout `/private/tmp/bs-fin-pr-11b`; instância
`/private/tmp/bs-fin11-local-3fi66bvw`, com project_id próprio, labels, único volume,
rede e portas exclusivos conferidos. Nesse diretório descartável, os runners
`testar-sql-local.sh` e `testar-compatibilidade-deploy.sh` usam apenas resets
`--local`. Os três scripts `testar-container-*-local.py` recebem esse workdir e
revalidam o alvo; paridade/rollback fazem resets exclusivos, concorrência grava
fixtures sintéticas e a prova de travas do rollback exige tabelas novas vazias.
Executar essas provas separadamente, restaurando o alvo local entre fixtures.
Logs desta execução estão em `/private/tmp/fin11-*.log`; catálogo e dados em
`fin11-evidence/` dentro da instância descartável. Não são artefatos versionados;
os runners e fixtures permitem reproduzir as provas.

Nenhum container/volume anterior foi reutilizado ou removido. Todas as migrations
anteriores foram comparadas byte a byte com a base. A CI inclui os novos testes
Node e um job SQL em VM efêmera, com identidade exclusiva, sem secrets/vínculo
remoto. Seus resultados remotos devem ser conferidos no HEAD do PR após publicar.
Não houve consulta ou alteração de banco remoto, nem alteração administrativa de
Preview, HML ou Production. O estado desses ambientes continua não comprovado por
esta etapa. Código versionado, Preview do aplicativo, migration aplicada e
ativação de regras são estados distintos.

**Riscos e próximo gate:** revisão independente do PR Draft e CI do HEAD. A chave
de idempotência precisa ser reutilizada para o mesmo pedido; uma nova chave não
permite inferir duplicidade física pela referência opcional. A API não edita
valores: correção antes de faturar exige cancelamento e novo serviço. Rollback
somente de 045 para 044 antes de qualquer uso, sem concorrência; nunca apagar
histórico para vencer a guarda. Integração visual FIN-PR-11C, homologação em HML,
restore, migrations remotas e ativação dependem de gates/autorização específicos.
Nenhum desses passos foi iniciado, e não houve merge.

## Checkpoint verificado no GitHub — 04/11/2026

Registro anterior, preservado como evidência histórica; não representa a main
mais recente confirmada no checkpoint FIN-PR-11B acima.

**Fonte e limite:** refs, PRs, checks e commits consultados no GitHub. Não houve
consulta autenticada ao catálogo efetivo do Supabase, ao banco HML ou às
variáveis/destino do Preview. Código mergeado, deploy do aplicativo, migration
aplicada e flag ativada **não são equivalentes**.

| Superfície            | Última evidência verificável                                                                                                                                                                                                                                                                                | Limite e próximo gate                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `main` (Git)          | HEAD `041aa27b2de41390f121fcc931a18430f34473e1`. [FIN-PR-10 / PR #90](https://github.com/therunnas/bslogistica/pull/90) mergeado por squash em `5795c0960d9b58a9c54037adfdfe55b6213f2fc2`; [DOC-MASTER-01/B1 / PR #91](https://github.com/therunnas/bslogistica/pull/91) mergeado por squash no HEAD atual. | Migrations até a 044 **versionadas**, sem presumir implantação remota.                                                                  |
| Qualidade no Git      | CI do HEAD `3851a6e` do PR #90 e do HEAD `568269f` do PR #91 aprovadas; seis threads do #90 resolvidas. Revisão Codex do #91 concluída sem achados.                                                                                                                                                         | CodeRabbit do #91 não fez revisão substantiva por limite de uso; estado `success` do check não equivale a parecer.                      |
| Vercel                | Check de deploy do merge do PR #90: `success`; checks de Preview nos PRs aprovados.                                                                                                                                                                                                                         | O deploy de Production após o PR #91 e o comportamento do domínio não foram revalidados neste checkpoint.                               |
| Preview               | Proteções de isolamento documentadas e testes de código anteriores.                                                                                                                                                                                                                                         | **Destino real do Supabase e separação dos dados não comprovados nesta verificação**. Não inserir dados reais sem o gate de isolamento. |
| HML / Supabase        | Sem leitura do catálogo remoto neste checkpoint.                                                                                                                                                                                                                                                            | Determinar projeto, versão do schema, migrations, roles, flags e possibilidade de restauração antes de aplicar alterações.              |
| Production / Supabase | Último relato histórico: migrations 032–034 aplicadas, motor por vigência ligado desde 29/10 e resolução comercial por função/colaborador **OFF**.                                                                                                                                                          | Situação atual e aplicação de 035–044 **não verificadas ao vivo**. Nenhuma migration ou flag alterada por estes merges.                 |
| Backup e acesso       | Backups e ensaios anteriores registrados nos históricos do projeto.                                                                                                                                                                                                                                         | Restauração integral atual, matriz E2E real de papéis e recuperação não foram comprovadas neste checkpoint.                             |

**Sequência de entrega:** concluir a reconciliação documental DOC-MASTER-01/B2,
verificar ambientes e backups por leitura antes de qualquer alteração, executar
FIN-PR-11 (container como serviço avulso), FIN-PR-12 (XLSX Dynamis) e FIN-PR-13
(conciliação/HML) em PRs isolados. Só então avaliar migrations remotas, rollout
financeiro, matriz E2E final e aceite do cliente por gates específicos. O PR
[antigo #63](https://github.com/therunnas/bslogistica/pull/63) permanece fora
deste fluxo até triagem explícita.

**Evidência negativa:** este checkpoint não certifica HML, Production/DB,
restore completo, regras comerciais ativadas ou homologação de ponta a ponta.

## Checkpoint histórico de 02/11/2026 — início do FIN-PR-10

**Registro histórico, não status vigente.** As referências abaixo a
`FIN-PR-10 em andamento`, `PR #90 Draft`, ausência de autorização de merge e
motor desligado em outubro descrevem decisões e estados daqueles dias. O
checkpoint de 04/11 acima prevalece para o Git atual; estados remotos continuam
sujeitos à comprovação por ambiente.

**Ambientes: último estado informado, não revalidado nesta sessão.** O GitHub
confirma o PR #89 (FIN-PR-09) mergeado em
`5e28b01fef992090136595aa2ee5dd97975e1160`, base do FIN-PR-10.
O FIN-PR-08 e as correções documentais anteriores permanecem integrados.
Código versionado, validação de testes, publicação de aplicação, aplicação de
migrations e ativação de funcionalidade são estados distintos.

- Motor financeiro por vigência: ativo em Production desde 29/10/2026, conforme
  informado. Resolução comercial de tarifas por função/colaborador: **desligada**.
  São controles diferentes.
- Migrations 032 (MFA opcional), 033 (integridade da taxa legada) e 034 (MFA
  somente no login): aplicadas em Production, conforme informado. As migrations
  035–043 estão versionadas. Não há aplicação remota da 043 confirmada no último
  checkpoint; as anteriores permanecem conforme o último estado informado. Código
  mergeado não comprova aplicação em HML ou Production.
- FIN-PR-01, 02, 03, 05, 06, 07 e 08 foram integrados; PR-04 foi absorvido pelo
  PR-02. FIN-PR-09 foi mergeado; FIN-PR-10 está em andamento local.
- SEC-DEP-01 foi integrado. A matriz E2E e a comprovação de isolamento real de
  Preview/HML permanecem pendentes; riscos residuais estão em [Segurança](SEGURANCA.md).

### Migrations financeiras versionadas

| Migration | Escopo                                 |
| --------- | -------------------------------------- |
| 030       | Regras comerciais anteriores           |
| 035       | Núcleo financeiro puro V2              |
| 036       | Integração do núcleo V2                |
| 037       | Leitores por componentes               |
| 038       | Período contratual e competência       |
| 039       | Catálogo de funções e período do turno |
| 040       | Snapshots de função e período          |
| 041       | Tarifas por função, período e vigência |
| 042       | Diária individual e bônus diário       |
| 043       | Dias especiais V2 (PR #89 mergeado)    |
| 044       | Calendário territorial (PR #90 no Git) |

O repositório contém suítes para essas entregas; resultados históricos não
comprovam execução nesta sessão. As migrações remotas e a ativação de preços não
podem ser inferidas de código mergeado nem dos testes locais.

### Regras financeiras e estágio

- Dia útil: referência líquida de 8 horas e intervalo conforme turno; saída
  antecipada proporcional; HE pela diária comercial dividida por 8 e multiplicada
  por 1,5, com arredondamento diário 15/45 ou acumulado quando configurado.
- Sábado: referência de cobrança de 4 horas, diária integral até a referência,
  HE depois dela e divisor 8 para HE.
- Domingo e feriado: regra integrada pelo **FIN-PR-09**, somente com resolução
  comercial ON: sem diária-base nem HE comum; minutos trabalhados × diária
  comercial resolvida × 2 ÷ 480; custo previsto separado também ×2; arredondamento
  especial configurável, com minutos exatos por padrão. Domingo também feriado
  recebe o fator uma vez. Com OFF, novos lançamentos preservam a regra anterior.
- Com resolução comercial ligada, a fonte é a diária individual vigente por
  colaborador e contrato; na ausência, a tarifa padrão de contrato, função,
  período e vigência; sem fonte válida, há erro. Operação sem contrato usa sua
  fonte de valor acordado. Com resolução desligada preservam-se valores legados.
- Função e período são snapshots; a HE usa a diária comercial resolvida. O bônus
  diário por acúmulo é separado, somado uma vez, fora da base de HE, e registrado
  por RPC administrativa com motivo e auditoria. Domingo/feriado em V2 admite
  bônus conforme FIN-PR-09; registros legados e resolução OFF recusam novos bônus.
- Preço cobrado não é custo do colaborador. O sistema apresenta **custo previsto**,
  não folha de pagamento; não se presume custo para o bônus.

### FIN-PR-09 — mergeado

A migration `20261110120000_043_dias_especiais_v2.sql` integra domingo/feriado ao
núcleo 035 somente com resolução comercial ligada. OFF conserva a 042; instalar
não recalcula lançamentos nem ativa tarifas. O classificador histórico permanece.
O componente especial substitui base e HE; o bônus permanece separado, sem fator
nem custo fictício. Prévia de dia especial elegível aguarda o banco ao salvar,
sem exibir o cálculo legado como estimativa da regra nova. Apontamentos e
Fechamento mostram especial e bônus separados. CSV/XLSX acrescentam esses
componentes quando há valor, mantendo as colunas anteriores nas mesmas posições
e preservando o formato quando ambos são zero. Não é a exportação específica
de cliente do FIN-PR-12. Preço individual, tarifa padrão e custo mantêm vigências
independentes; operação sem contrato usa valor acordado e minutos exatos.

`contract_terms.special_rounding_mode` é imutável na versão: `minutos` (default)
ou `meia_hora_15_45` (fronteiras do núcleo: 15 inclui meia hora, 45 inclui hora
inteira). Só a cobrança arredonda; o custo usa minutos efetivos. A nova RPC
`registrar_condicao_contrato_especial` espelha os parâmetros da RPC antiga e
acrescenta `p_special_rounding_mode`; registra uma versão com motivo e auditoria.
As assinaturas antigas permanecem; o registro pela assinatura antiga herda o
modo da versão ativa imediatamente anterior (ou minutos sem anterior), e a
correção contratual preserva o modo da versão corrigida. Trocar modo exige nova
vigência. A configuração não tem nova interface nesta etapa.

Provas locais reproduzíveis: suíte `supabase/tests/043_dias_especiais_v2.sql`,
`npm run test:dias-especiais` e
`python3 scripts/testar-dias-especiais-local.py /private/tmp/bs-fin09-local-<id>`.
O último exige uma instância exclusiva recém-criada, com workdir, `project_id`,
volume e rede correspondentes; recusa vínculo remoto. Executa resets **locais**
até a 042, compara catálogo, dados OFF e ensaia rollback permitido/bloqueado.
Normaliza UUIDs técnicos por chaves lógicas e timestamps voláteis; preserva
valores, minutos, fontes e classificação. A coluna nova é excluída da comparação
com a 042. Evidências ficam na pasta temporária da instância, fora do Git.
Os runners SQL/deploy devem executar em cópia isolada do código, com configuração
temporária própria; nunca sobre volumes anteriores associados ao `project_id`
versionado. CLI fixado em 2.117.0 para reprodução; nenhuma dependência do app nova.

Rollback: [rollback-dias-especiais-v2.sql](runbooks/rollback-dias-especiais-v2.sql).
Recusa uso especial V2 ou configuração incompatível, inclusive auditada; não
apaga bônus, snapshots, tarifas, lastro ou trilha. Nenhuma aplicação remota desta
migration é autorizada por esta implementação. Evidências da entrega e da revisão
R1 estão no PR #89. Especial V2 não faturado que exija recálculo com resolução OFF
é recusado com 55000; notas sem mudança financeira preservam valores, e ON permite
recalcular preservando o bônus. Faturados continuam imutáveis.

### FIN-PR-10 — calendário territorial nacional (histórico do PR #90)

Desenvolvimento e testes exclusivamente locais, seguido de commits, push e PR
Draft. Sem autorização para merge, Ready for Review, deploy, HML, Production,
ativação de tarifas ou carga remota. Migrations 001–043 permanecem intactas.
O estado mutável permanece centralizado neste documento; PROGRESS aponta para cá.

A migration `20261111120000_044_calendario_territorial.sql` está implementada na
branch `feat/fin-pr-10-calendario-nacional`, sem aplicação remota. O primeiro
commit, `4edb43e40182811ce1b6f805bdcf82a2af68aa81`, contém somente este documento e
PROGRESS. O modelo usa `financial_holidays`, catálogo IBGE, local de execução
vigenciado e cobertura oficial anual por âmbito. Novas presenças ON sem local ou
cobertura confirmados são recusadas; OFF conserva o caminho anterior. Não houve
carga real de calendário, backfill ou ativação de preços.

Validação local repetida no FIN-PR-10/R1: 45 suítes SQL no schema 044 e todas
as 57 suítes Node passaram; lint, TypeScript, Prettier nos formatos suportados e
build também. A suíte 044 contém 255 asserções, incluindo 52 específicas de R1;
a renderização comportamental da interface cobre 17 casos.
Paridade financeira OFF exata 042/043 e 043/044, catálogo e rollback permitido e
bloqueado foram comprovados na instância descartável exclusiva. Compatibilidade
034, 037, 038, 039, 040, 041, 042, 043 e 044 aprovada: 541 asserções, zero falhas.
Entrega em PR Draft para revisão independente, sem Ready for Review ou merge.

Na revisão R1 do PR #90, o cadastro escolhe a interface pelo regime financeiro
confirmado e pela capacidade: OFF mantém calendário/RPCs legados; ON com 044 usa
territorial; estado desconhecido não libera cadastro. Brasília/DF mantém o código
IBGE `5300108` e os mesmos campos de vínculo/snapshot, sem município jurídico.
O âmbito `distrital` exige UF DF, sem código municipal; o calendário do DF exige
coberturas nacional e distrital, sem terceira cobertura municipal fictícia.
As demais UFs mantêm as três coberturas. Nenhuma data distrital foi inferida.

RED/GREEN registrados para OFF e DF. A matriz distrital confirma admin sem fator
em AAL1 e admin com fator em AAL2; recusa MFA pendente, operacional, sem papel,
anon e sessão inválida sem escrita/auditoria residual. Sobreposição com domingo
cobra ×2 uma vez; fatura e snapshots permanecem imutáveis após aposentadoria de
feriado/cobertura. O corpo da derivação financeira e os pins de MD5 não mudaram
em R1. As duas referências de Ilhota esclarecem a alteração do Anexo Único do
Decreto 14/2026 pelo Decreto 235/2026, sem mudar datas ou classificações.

Os ensaios R1 reutilizaram somente a instância descartável exclusiva FIN10 após
revalidar labels, volume, rede e fixtures sintéticos. Nenhuma ação em banco
remoto. PR #90 permanece Draft para revisão independente. Resultados da CI devem
ser conferidos no HEAD remoto do PR. Sem Ready for Review ou merge.

Contratos, guardas e reprodução em
[calendario-territorial.md](financeiro/calendario-territorial.md); pesquisa oficial,
datas e pendências em
[calendario-fontes-oficiais.md](financeiro/calendario-fontes-oficiais.md). Fontes
municipais ainda exigem conferência do cliente e da legislação aplicável; anos
sem calendário anual confirmado permanecem pendentes. A regra de turnos mistos
não foi ativada: classificações distintas são bloqueadas com 55000 até decisão
comercial explícita sobre segmentos e horários do intervalo.

Regras confirmadas para esta etapa:

- Calendário expansível para todas as UFs e municípios brasileiros, sem alteração
  de código ao incluir uma nova localidade. Prioridade inicial: Santa Catarina,
  Itajaí, Navegantes, Balneário Camboriú, Brusque, Barra Velha e Ilhota.
- O local real da execução determina a abrangência nacional, estadual e municipal;
  não se presume a sede do cliente. Localidade conhecida e calendário oficialmente
  confirmado são estados distintos. Ausência de cadastro não prova dia útil.
- Fechamento predominantemente quinzenal, com modalidade mensal. Não há aprovação
  do cliente no fluxo de fechamento.
- Jornada de referência de 8 horas; intervalo conforme turno, de 1 ou 2 horas.
  Turnos mistos exigem identificação dos segmentos por data civil; sem horário do
  intervalo, não se inventa sua distribuição nem nova cobrança. A classificação
  financeira por segmento depende de regra comercial confirmada; FIN-PR-09 segue
  protegido enquanto essa decisão estiver pendente.
- Adicionais avulsos podem ter competência de cobrança diferente da execução.
  Container é serviço avulso com cobrança negociada e pagamento por container,
  exclusivo do FIN-PR-11; não será desenvolvido nesta etapa.
- Diária individual muda por admin mediante nova vigência. Históricos, snapshots
  e faturas não são reprecificados. Domingo/feriado e bônus seguem FIN-PR-09.
- Custo previsto não é folha de pagamento.
- Fontes oficiais para 2026–2028 serão conferidas; datas municipais dependem de
  conferência do cliente antes de ativação real. Sem comprovação, ficam pendentes;
  ponto facultativo não vira feriado automaticamente. Nenhuma carga real na migration.

### Referência para conciliação futura

A referência comercial informada para 01–15/09/2026 contém 141 lançamentos,
14 colaboradores e total de R$ 35.118,12: R$ 33.050,00 em diárias e
R$ 2.068,12 em HE. Não contém custos pagos. Diárias variam entre colaboradores
mesmo na mesma função; a HE usa a diária individual da linha e não inclui bônus.
A decisão comercial é diária individual por colaborador, contrato e vigência,
sem criar funções fictícias. A conciliação pertence ao FIN-PR-13.

## Production — referência de infraestrutura

Último estado informado, não revalidado nesta sessão.

| Item                  | Estado                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Aplicação             | publicada em `admin.bslogisticas.com.br`                                                                                                      |
| Hospedagem            | Vercel, projeto `bs-logistica-sistema`, deploy a partir de `main`                                                                             |
| Banco e Auth          | Supabase, projeto `ehkduqokntemtmqzdrbd`                                                                                                      |
| Migrations            | Ver checkpoint acima; versão no Git não comprova aplicação remota.                                                                            |
| Cadastro público      | bloqueado (`disable_signup = true`)                                                                                                           |
| Usuário `operacional` | perfil homologado com uma conta existente que era admin e foi rebaixada; contas definitivas ainda não criadas ([PROGRESS.md](../PROGRESS.md)) |

O **Preview** da Vercel não pode usar o banco de produção: o escopo Preview não
deve ter as variáveis de Production, e o código recusa (no build e em cada
requisição) um Preview apontado para o projeto Supabase de Production. Sem
destino de teste próprio, o build de Preview falha de propósito, e conectá-lo ao
banco de produção para deixar o check verde é proibido. Ver "Isolamento entre
ambientes" em [docs/SEGURANCA.md](SEGURANCA.md).

O site institucional (`bslogisticas.com.br`) é outro projeto, em outro
repositório, e não faz parte deste.

## Histórico de vigências financeiras — fotografia de 23/10/2026

**Histórico, não estado atual:** as afirmações e pendências desta seção retratam
o checkpoint de 23/10/2026 e foram superadas onde divergirem do checkpoint acima.
A autorização e o MFA seguem as instruções atuais de [Segurança](SEGURANCA.md).

Estado em 23/10/2026 (C05-B7.2). Quatro níveis que não se confundem: **implementado**
(existe no código), **validado** (foi testado), **publicado** (está disponível aos
usuários) e **pendente**.

**Banco — migrations `021` a `028`**

- Implementado e **publicado em Production**: tabelas de vigência de contrato, de custo do
  colaborador e do valor acordado da operação, trilha `financial_terms_audit`, as RPCs de
  registro, os cadastros atômicos, a chave do motor e os bloqueios da `027` e da `028`.
- Validado: ensaio local de cada migration e de sua reversão, mais conferência de catálogo
  em Production depois de cada lote (L1 a L4): histórico, estruturas, permissões, RLS,
  dados e valores financeiros idênticos. Os logs de Production (Postgres, API, Auth e
  Vercel) **não** foram verificados depois dos lotes.
- Efeito já ativo, mesmo com o motor desligado (`028`): o contrato de uma operação que tem
  apontamento ou valor acordado cadastrado não troca, e esse contrato não é excluído.

**Motor financeiro**

- Motor atual (`010`): **ligado**, sem alteração (gatilho `trg_timesheet_entries_calculo_financeiro`
  habilitado; `derivar_valores_financeiros` e `gerar_fatura` com o mesmo corpo de antes).
- Motor por vigência (`025`): instalado e **desligado**. `financial_engine_settings` tem uma
  linha com `vigencia_ativa = false`, nunca alterada; os gatilhos novos (cálculo por vigência,
  três bloqueios de edição direta de taxa e congelamento de jornada de turno) estão
  desabilitados.
- Nenhuma vigência foi cadastrada: as três tabelas de versões e a trilha têm 0 linhas.
- **Ativar o motor é decisão de negócio e etapa própria**: não é feita por nenhuma tela. A RPC
  `alterar_motor_vigencia` é executável por `admin` em AAL2 pela API. A `027` recusa ligar
  com divergência entre coluna e vigência, mas `p_aceitar_pendencias = true` ainda liga com
  cadastros sem vigência, e o motor novo recusaria apontamento remunerável deles.

**Pendências de vigência (decisão de negócio)**

Há 7 cadastros em uso sem vigência para hoje: 4 colaboradores, 2 contratos e 1 operação sem
contrato. Falta decidir a data de início e o valor de cada vigência; nada foi presumido nem
cadastrado.

**Interfaces — PR B**

- **Implementado**, só na branch `feat/c05b-interfaces-vigencia`: histórico e reajuste de
  vigências em contratos, colaboradores e operações sem contrato; cadastro atômico (usado só com o
  motor ligado); apontamentos com valor do banco, prévia e origem; turnos usados com jornada
  protegida; tela `/implantacao-vigencias` (consulta). As telas de cadastro não ligam nem
  desligam o motor. A C05-B8.6 acrescenta à `/implantacao-vigencias` o controle de **ligar** o
  motor (Server Action com `exigirAdminAal2()`, RPC `alterar_motor_vigencia` com o JWT da sessão,
  motivo, frase de confirmação, `p_aceitar_pendencias = false`). A reversão tem módulo e trava próprios (RB-01, abaixo).
  Usado **só na homologação** (C05-B8.8, 24/10/2026, pelo Preview do PR, admin AAL2): motor
  ligado lá, com dados `HML-TESTE`; em Production o motor segue **desligado**. É controle técnico
  de implantação: a única forma segura de ligar o motor, por isso permanece até existir
  procedimento substituto validado.
  **Trava de servidor (C05-B8.12):** o controle não é permanente. A Server Action só aceita o
  pedido se a variável `BS_ATIVACAO_MOTOR_HABILITADA` (server-only, nunca `NEXT_PUBLIC_*`) valer
  exatamente `true`; ausente ou com qualquer outro valor, o padrão em todos os ambientes, ela recusa
  (código `desabilitada`) depois da autorização e antes de tocar o banco, e a tela nem mostra botão
  nem diálogo. Não substitui nada: admin em AAL2, motivo, frase e a RPC do banco seguem exigidos; a
  ativação só liga. Procedimento para Production, com autorização própria: definir a
  variável no projeto da Vercel, publicar, ligar o motor pela tela, remover a variável e publicar de
  novo.
- **RB-01** (reversão controlada do motor, implementada localmente, sem deploy): botão "Desligar
  motor" em `/implantacao-vigencias`, só com o motor ligado e consistente. Server Action
  `desligarMotorAction`: `exigirAdminAal2()`, trava própria `BS_REVERSAO_MOTOR_HABILITADA`
  (server-only; só `true` abre), cliente da sessão (sem `service_role`) e a RPC
  `alterar_motor_vigencia(false, motivo)`, que audita em `financial_terms_audit`. Motivo e frase
  `DESLIGAR MOTOR`. Sem migration. Procedimento: `docs/runbooks/reversao-do-motor.md`.
- **C05-B8.9** (no mesmo PR): as telas de apontamento (admin e operacional) recusam salvar linha
  com entrada igual à saída, que o cálculo mediria como 24 h; o cálculo não mudou e o banco ainda
  aceita a igualdade por outra via (corrigir no banco exige migration própria). O cadastro de
  colaborador novo com o motor ligado pede a data de início do custo (antes era sempre hoje, o que
  recusava apontar dias anteriores).
- **C05-B8.10** (no mesmo PR; migration `029` **só local**, não aplicada em banco remoto): regras
  confirmadas pela BS. Valem no motor por vigência; o motor antigo (`010`) não muda.
  - **Hora extra paga** pelo valor-hora acordado com cada colaborador (`employee_cost_terms.ot_hourly_cost`,
    opcional, congelado no apontamento). Cobrança e custo independentes: o fator do contrato só
    entra na cobrança. Sem valor acordado, segue diária de custo ÷ jornada (o comportamento anterior).
  - **Saída antecipada**: custo proporcional às horas trabalhadas, com os dois horários; a cobrança
    continua a diária inteira.
  - **Adicionais de serviço** (`billing_additionals`): motivo, valor, referência, período, cliente e
    operação opcional; só por RPC (admin AAL2, trilha), cancelamento com motivo, sem exclusão;
    `gerar_fatura` inclui os que cabem inteiros no período, um item cada.
  - **Entrada igual à saída** recusada pelo banco (23514), por qualquer via.
  - As telas só oferecem isso quando `estado_motor_vigencia()` anuncia `regras_bs`: o código pode
    ser publicado antes da `029` sem mudar nada. O Dashboard mostra a receita dos apontamentos; os
    adicionais aparecem no Faturamento e na fatura.
  - Validado localmente: aplicar a `029` sobre dados existentes não altera nenhum valor gravado, e a
    reversão devolve catálogo e dados idênticos aos da `028`.
- **Regras comerciais pendentes** (decisão da BS, nada implementado por suposição): arredondamento de
  meia hora (15 e 45 min) e se é diário ou depois de acumular a quinzena; feriado (100% com diária
  por 4 h e extra acima disso); sábado e domingo; cobrança ao cliente por saída antecipada; preço
  avulso por serviço completo ou por trabalhador; parâmetros da operação sem contrato (8 h, fator 1,
  10 min fixos); presença ou substituição sem horário; como os adicionais entram no Dashboard e nos
  Relatórios. Fechamento quinzenal com aprovação do gerente do cliente: PR #63, separado.
- **Validado**: as 29 suítes Node (`test:*`) e as 26 SQL locais; homologação ponta a ponta na
  C05-B8.8 (antes da `029`).
- **Publicado**: as interfaces (PR #68) estão na `main` e em Production. O controle de ativação e
  as correções da C05-B8.9 (PR #69) estão só no Preview, ligado à homologação. A C05-B8.10 está
  só na branch local, sem push.
- **Pendente**: decisão da BS sobre as regras comerciais acima; aplicar a `029` na homologação e
  validar; merge do PR #69 e procedimento para ligar o motor em Production, cada um com autorização.

**Separados deste trabalho**: o PR #63 (fechamento quinzenal, rascunho) e a migration `019`
(nunca aplicada).

**Backups de Production** (dump lógico do PostgreSQL, cifrado com `age`, uma cópia local e uma
cópia externa cifrada)

- O mais recente é de 23/10/2026, **depois da `024` e antes da `025`**; uma restauração dele
  exigiria reaplicar a `025` a `028`. Não existe backup posterior à `025`.
- Limites: o dump por schema **não preserva event triggers** (o `ensure_rls` é recriado à mão
  e o privilégio para isso em Supabase hospedado não está comprovado; ver
  [recuperação](runbooks/recuperacao-c02-020.md)); não cobre a configuração de Auth, os segredos
  da Vercel, o Storage nem `vault` e `realtime`; a restauração do pacote mais recente não foi
  ensaiada (o ensaio vale para o procedimento); a cópia da chave privada no gerenciador de
  senhas não foi verificada. Production não tem backup gerenciado nem PITR.

**Limpeza final do projeto** (dados fictícios, ramos antigos, rascunhos): etapa futura, não
iniciada.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS 4 ·
shadcn/ui · Supabase (Postgres, Auth, RLS) com `@supabase/ssr` · TanStack Query ·
npm · Vercel. Node ≥ 22.6. Sentry para monitoramento de erros.

Next.js é a arquitetura definitiva. TanStack Start, TanStack Router, Vite, Nitro e
as integrações do Lovable foram removidos. `@tanstack/react-query` permanece: é a
camada de dados e não tem relação com o TanStack Router.

## Módulos

**Área administrativa** — só `admin`, com o piso de MFA aplicável à conta:

| Módulo               | Função                                                           |
| -------------------- | ---------------------------------------------------------------- |
| Dashboard            | indicadores do período: diárias, horas extras, receita, margem   |
| Clientes e contratos | cadastro e regras de cobrança                                    |
| Colaboradores        | cadastro com função, contato e custo por diária                  |
| Operações            | operações fixas e avulsas, turnos e equipe                       |
| Apontamentos         | presença, horários e intervalo, com cálculo automático           |
| Faturamento          | fechamento por cliente e período                                 |
| Relatórios           | por colaborador, operação e lançamento, com exportação CSV       |
| Usuários             | convite, papel, atribuição de operações, revogação e reativação  |
| Configurações        | segurança da conta: ativar MFA (o `operacional` também desativa) |

**Área operacional** — só `operacional`: a tela `/operacional` registra presença e
horários das operações atribuídas ao usuário, falando exclusivamente com as cinco
RPCs da superfície operacional. Nenhum valor financeiro é exibido.

Mais: login, segundo fator, recuperação de senha, logout e renovação de sessão.

## Autenticação e papéis

- Dois papéis: `admin` e `operacional`; TOTP é opcional para ambos. Sem fator
  verificado, AAL1 respeita o papel; com fator, AAL1 é bloqueado até o TOTP no
  login, e depois não há novo desafio por funcionalidade. Desativar o próprio
  fator exige código novo na interface.
- O acesso direto às tabelas de negócio exige `admin` e o piso
  `mfa_cotidiano_ok()`. O `operacional` chega aos dados só pelas RPCs restritas.
- O último admin é protegido por trigger, e as alterações de usuário e papel são
  auditadas em `admin_audit_log` (best-effort).

O modelo completo está em [SEGURANCA.md](SEGURANCA.md).

## Segurança relevante em vigor

- Identidade utilizável exigida pelo banco (C02, migration `020`, aplicada em
  18/10/2026): conta existente e não banida, e sessão do JWT viva.
- RLS protege os dados; policies restritivas aplicam papel e piso de MFA.
  Nomes históricos com `aal2` não implicam AAL2 obrigatório para todos.
- Funções `SECURITY DEFINER` validam autorização internamente; cadastro público
  permanece bloqueado. SEC-DEP-01 foi integrado.
- Valores financeiros derivados por trigger; linha faturada imutável.
- Content-Security-Policy com nonce, em enforcement, mais cabeçalhos de segurança
  (HSTS pela plataforma).
- `service_role` usada só no servidor; segredos fora do Git e do bundle.

## Testes e CI — registro histórico

Os números abaixo refletem a fotografia anterior e não foram revalidados nesta sessão.

| Verificação                     | Estado                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Suítes Node (`test:*`)          | 29 scripts, todos exigidos pela CI; 11 deles são da C05-B                                                            |
| Testes SQL (`supabase/tests`)   | 26 arquivos; rodam localmente (`scripts/testar-sql-local.sh`), **não** na CI                                         |
| CI (`.github/workflows/ci.yml`) | em todo PR e em push para `main`: lint, `tsc`, as 29 suítes e build, sem secret e sem tocar o Supabase de Production |
| `npm audit`                     | 0 vulnerabilidades (SEC-DEP-01: `@sentry/nextjs` 10.75.2 e `fast-uri` 3.1.9; ver [SEGURANCA.md](SEGURANCA.md))       |

## Riscos e pendências confirmados

Registrados em [SEGURANCA.md](SEGURANCA.md) (seção "Riscos residuais") e em
[PROGRESS.md](../PROGRESS.md). O diretório [divida-tecnica/](divida-tecnica/) tem
só dívidas já resolvidas, como histórico.
