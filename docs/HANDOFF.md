# Handoff ativo

<!-- workflow-handoff:v1 -->

**HML-LIMPEZA-01 — roteiro de limpeza do HML para a 050 no PR Draft #125; sessão 03: o ensaio local passa a conferir a identidade da stack (`bs-hml-ensaio-20b`) antes de qualquer reset, restauração ou escrita, de forma fatal. Ensaio local BLOQUEADO (sem Docker/Supabase CLI/servidor PostgreSQL/`python3` e sem backup 050 nesta máquina). Nada executado no HML. Production na 034.** SHAs e contagens abaixo são evidências de 10/11/2026; reconferir antes de agir.

## Identificação

| Campo | Valor |
| --- | --- |
| Etapa | HML-LIMPEZA-01 — Gate 4, preparação |
| Gate atual | Preparação documental em PR Draft (#125), sessão 03 de correção; ensaio local BLOQUEADO; limpeza remota NÃO autorizada. Parecer: NO-GO para pedir a execução até o ensaio com 0 FAIL |
| Último gate concluído | #124 (DOC-01) mesclado por squash em `3cda0e55906401a635d5663b23d823d5a98b9fb6` |
| Worktree | Windows local `C:\Users\PC CASA\Documents\GitHub\bslogistica-hml-limpeza-050` (git worktree). Outros: `...\bslogistica` (`claude/jolly-allen-fqechw`, HANDOFF antigo não commitado, não usar) e `...\bslogistica-ux-*`/`-docs-progress` (branches mescladas). Descobrir de novo na retomada |
| Branch | `docs/hml-limpeza-050`, criada de `origin/main`; reaproveita seletivamente 5 arquivos de `origin/docs/hml-limpeza-runbook` (`169f592`), sem mesclar a branch antiga |
| Base | main `3cda0e55906401a635d5663b23d823d5a98b9fb6` |
| HEAD validado | 6f4e3bbf8711c4c579e7e9d3c1f1c36bb6eaa21a (sessão 02, CI `validar` e `sql-local` SUCCESS) + o commit de correção da sessão 03. HEAD publicado e CI por SHA: consultar no PR #125, sem commit recursivo só de status |
| Alterações não commitadas | Nenhuma além deste conjunto |
| PR | [#125](https://github.com/therunnas/bslogistica/pull/125), Draft, desta branch contra main. #119–#124 mesclados |
| Ambiente-alvo | HML `qbnfcmrxmssnwkhaitgd` (050) só lido (GET no PostgREST com a sessão admin e a RPC de leitura `estado_motor_vigencia`); nenhuma escrita. Production `ehkduqokntemtmqzdrbd` não tocada (034) |
| Última ação comprovada | Sessão 03: guarda de destino fatal antes de cada `db reset` (A e G), depois do reset e antes das seções C e D; bateria com stubs 14/14 (RED no `6f4e3bb` e no mutante sem guarda), verificação estática da ordem GREEN, `bash -n`, Prettier do runbook, `check:workflow` e `git diff --check` PASS. Nenhum reset nem banco real |
| Próxima ação exata | Usuário revisa o PR #125. Para ensaiar no Mac: Docker, Supabase CLI, `psql`, `python3`; stack `bs-hml-ensaio-20b` iniciada com `config.toml` próprio (`[db] port` = porta do ensaio) e sem `SUPABASE_PROJECT_ID`; backup novo do HML na 050 com `impressao-digital-hml.json`; `KEYCHAIN_ITEM=<item> scripts/hml-limpeza-ensaio-local.sh <backup> <workdir> [porta]` com 0 FAIL. Só então pedir autorização nominal da limpeza (runbook, seção 8) |

## Estado atual para retomada

| Campo | Estado comprovado / referência |
| --- | --- |
| Main | `3cda0e5` (#124 sobre `c6f9130`): migrations até 050 e consumidores 047/049 ([#119](https://github.com/therunnas/bslogistica/pull/119)); rótulos da avulsa ([#120](https://github.com/therunnas/bslogistica/pull/120)); menu e botão de Containers retirados, fluxo avulso homologado ([#121](https://github.com/therunnas/bslogistica/pull/121)); valor acordado pelo contrato ([#122](https://github.com/therunnas/bslogistica/pull/122)); confirmação antes de gerar fatura ([#123](https://github.com/therunnas/bslogistica/pull/123)); `PROGRESS.md` alinhado ([#124](https://github.com/therunnas/bslogistica/pull/124)). `vercel.json` mantém `main:false`; nenhum deployment Production do SHA |
| HML | 050 desde 09/11/2026; `tarifas_por_funcao=false`; `vigencia_ativa=true`. Backup lógico pré-aplicação (59 tabelas) entregue ao usuário, fora do Git |
| Production | 034, não tocada. O frontend publicado é anterior e espera schema 045: risco conhecido, resolvido apenas pela implantação 034 → 050 |
| Preview | Deployment da branch `claude/jolly-allen-fqechw`; vínculo com HML **não comprovado deste container** (proxy bloqueia `vercel.app`, sem credencial Vercel). Configuração registrada em [AMBIENTES.md](AMBIENTES.md) |
| Negócio | [NEGOCIO.md](NEGOCIO.md) e [matriz](NEGOCIO_X_SISTEMA.md); C1–C6 seguem pendentes e não bloqueiam o piloto com resolução OFF |
| Dynamis | Conciliação técnica encerrada: a planilha usa datas 1904 (01–15/09/2026; o E06 leu 2022). Com intervalo de 2h em dia útil o V2 reproduz HE e arredondamento; diferenças comprovadas: saída antecipada −R$ 338,04 (49 dias), sábado 05/09 +R$ 46,88 (2 linhas), arredondamento por lançamento +R$ 0,075. Pendentes comerciais da Dynamis: intervalo do dia útil, saída antecipada, os dois sábados. Regras gerais da BS inalteradas |

## Última tarefa

| Campo | Valor |
| --- | --- |
| Tarefa executada | HML-LIMPEZA-01, sessão 03 (10/11/2026): corrigir a ordem de segurança do ensaio local no PR #125 (Draft), sobre `6f4e3bbf8711c4c579e7e9d3c1f1c36bb6eaa21a`. Só `scripts/hml-limpeza-ensaio-local.sh`, `docs/runbooks/limpeza-hml-sintetico.md` e este HANDOFF. Nenhum reset, ensaio ou limpeza executado |
| Resultados e testes comprovados | **Causa:** `reiniciar()` rodava `supabase db reset --local` antes de qualquer conferência de destino; a única conferência (nome do container e porta no `docker ps`) vinha depois, em A, como `check` que só somava FAIL; a etapa G resetava sem conferência nenhuma. **Correção:** `verificar_destino()` fatal (`recusar_destino`, exit 7) no início, como 1ª instrução de `reiniciar()` (A e G), de novo depois do reset e antes da restauração, e antes das seções C e D. Exige juntos: `config.toml` do workdir com uma única linha `project_id` = `bs-hml-ensaio-20b` (constante) e `[db] port` = porta; nenhum `SUPABASE_PROJECT_ID` no ambiente nem em `.env`/`.env.local` do workdir (a CLI roda sem `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID` e `SUPABASE_DB_PASSWORD`); container `supabase_db_bs-hml-ensaio-20b` rodando, rótulo `com.supabase.cli.project` igual, 5432 publicada só nessa porta e único container na porta; `supabase status -o env` com `DB_URL` em `127.0.0.1:<porta>`; `inet_server_addr()` do banco em `127.0.0.1:<porta>` igual a um IP do container. **Testes (sem Docker, banco ou CLI reais), no scratchpad:** bateria que roda o script verdadeiro com stubs de `docker`/`supabase`/`psql` (o `db reset` só registra): versão nova 14/14 PASS (correto alcança o reset só depois de todas as conferências; `project_id` errado e duplicado, rótulo de outro projeto, outro container na porta, banco de outro container, porta incompatível, porta publicada diferente, `status` em outra porta, instância ausente, instância parada, `SUPABASE_PROJECT_ID` no ambiente e no `.env` → exit 7 sem reset; destino que muda depois do reset → exit 7 sem restauração). RED: `6f4e3bb` 0/14 e mutante sem a guarda 0/14 (os 13 inválidos alcançam o reset); mutante sem a conferência inicial 14/14 (o `reiniciar()` sozinho protege a etapa G). Verificação estática: GREEN na versão nova, RED no `6f4e3bb` e no mutante sem guarda. `bash -n` PASS; Prettier do runbook PASS; `check:workflow` PASS; `git diff --check` PASS. **Não executados:** reset real, ensaio em banco e os formatos reais de saída de `docker`/`supabase status` (BLOQUEADO nesta máquina) |
| Código e PR afetados | `scripts/hml-limpeza-ensaio-local.sh`, `docs/runbooks/limpeza-hml-sintetico.md`, `docs/HANDOFF.md`, no PR #125 (Draft). SQL do expurgo, `hml-restaurar-local.sh`, `hml-impressao-digital.sql` e `docs/runbooks/README.md` inalterados. Nenhum `src/`, migration, `package.json`, lockfile, workflow ou `.env` |
| Ambientes envolvidos | Somente local (worktree e scratchpad, stubs sem efeito). Nenhum reset, banco, Docker ou CLI real. HML, Production, Auth, usuários, flags, `.env` e credenciais não tocados; acesso remoto só à API pública do GitHub (PR e CI) |
| Pendências e decisões | (1) Ensaio local da versão 050 com 0 FAIL no Mac (Docker, Supabase CLI, `psql`, `python3`; stack `bs-hml-ensaio-20b` iniciada; backup novo do HML na 050 e sua impressão digital); (2) se algum formato real (rótulo, `docker port`, `DB_URL`, IP do servidor) divergir, o ensaio encerra com código 7 sem resetar: corrigir a guarda por revisão, nunca afrouxar; (3) erros de restauração fora da lista aceita: investigar e ampliar só por revisão; (4) destino independente da segunda cópia do backup (decisão da BS); (5) se o HML receber escrita depois de 10/11/2026, refazer o inventário e a 3.6b; (6) autorização nominal da limpeza (runbook, seção 8) |
| Próxima ação exata | Revisão do PR #125 pelo responsável; nenhuma execução remota, merge ou Ready sem autorização nominal |
| Autorizações e proibições | Autorizados (sessão 03): os três arquivos acima, verificações estáticas e com stubs, commit/push no PR #125 mantendo Draft. Proibidos: resetar qualquer banco, HML, Production, Auth, migrations, expurgo, `src/`, `supabase/migrations/`, dependências, workflows, `.env`, merge, Ready, force push, outro PR ou ambiente remoto, iniciar o ensaio |

### Tarefa anterior — HML-LIMPEZA-01, sessão 02 (10/11/2026, PR #125 Draft em `6f4e3bbf8711c4c579e7e9d3c1f1c36bb6eaa21a`)

| Campo | Valor |
| --- | --- |
| Tarefa executada | HML-LIMPEZA-01, sessão 02 (10/11/2026): corrigir as verificações de segurança e os testes do roteiro de limpeza no PR #125 (Draft), sobre `51d18f86b8a38519539d6d63adbe55f9b4ba371f`. Só `docs/runbooks/limpeza-hml-sintetico.sql`, `docs/runbooks/limpeza-hml-sintetico.md`, `scripts/hml-limpeza-ensaio-local.sh` e este HANDOFF. Limpeza remota NÃO executada nem autorizada |
| Resultados e testes comprovados | **Causa:** na 3.7, `count(*) FILTER (WHERE NOT (legal_act LIKE 'E2E-%' OR name LIKE 'E2E-%' OR name LIKE 'AUTH01C2%'))`; feriado legado (044: `territory_scope='legado'`, `legal_act` nulo) de nome desconhecido dá `NOT (NULL OR false OR false)` = NULL, o FILTER descarta a linha, a verificação aprova e o `TRUNCATE` o apagaria (fail-open). **Correção:** `(...) IS NOT TRUE` na 3.7 (feriados e coberturas) e, por robustez, em 3.3, 3.4, 3.5, 3.8 e 3.9; 3.11 com `(email LIKE '%.invalid') IS FALSE` (e-mail nulo não conta como admin real); impressão digital de municípios/funções preservados = complemento exato do `DELETE`. Só a dos feriados era explorável (as demais colunas são `NOT NULL`). **Ensaio:** `exigir()` confere a saída exata de cada preparo e limpeza (C1, C1b, C2, C3, C4 por `application_name`, C5) e interrompe com código 6 se não comprovar, nunca PASS; marcador ausente antes de inserir; C1b confere que a recusa veio da 3.6b; C1c novo (feriado legado com `legal_act` nulo, em transação externa desfeita pelo aborto, inserção provada por `PREPARO_C1C=1`); impressão digital igual à base depois de C1–C4. **Restauração:** `hml-restaurar-local.sh` termina com sucesso mesmo com erro; o ensaio agora exige as marcas de hash, o resumo das 6 etapas, só o erro aceito (`supabase_realtime_admin`), soma dos listados igual ao total, 0 erro na reaplicação de privilégios e impressão digital da cópia igual à do HML (`impressao-digital-hml.json`, novo 4º argumento) exceto `fn_privilegios_md5`/`event_triggers_md5`; senão código 4. **Validação (sem banco):** `bash -n` PASS; Prettier do runbook PASS (HANDOFF já não passava no Prettier no `51d18f8`, formato mantido); verificador estático descartável no scratchpad: RED no `51d18f8` (20 falhas), GREEN na correção (0); `check:workflow` PASS; `git diff --check` PASS. **Não executados:** RED/GREEN em banco, o validador Python da restauração e o ensaio completo: o PostgreSQL 18 desta máquina só tem cliente (sem `share/`, `initdb` falha), não há Docker, Supabase CLI nem `python3` real |
| Código e PR afetados | `docs/runbooks/limpeza-hml-sintetico.sql`, `docs/runbooks/limpeza-hml-sintetico.md`, `scripts/hml-limpeza-ensaio-local.sh`, `docs/HANDOFF.md`, no PR #125 (Draft). `scripts/hml-restaurar-local.sh`, `hml-impressao-digital.sql` e `docs/runbooks/README.md` inalterados. Nenhum `src/`, migration, `package.json`, lockfile ou workflow |
| Ambientes envolvidos | Somente local (worktree e scratchpad; tentativa de `initdb` local recusada pela instalação, nada iniciado). HML, Production, Auth, usuários, flags, `.env` e credenciais não tocados; nenhuma leitura remota nesta sessão além da API pública do GitHub (PR e CI) |
| Pendências e decisões | (1) Ensaio local da versão 050 com 0 FAIL no Mac (Docker, Supabase CLI, `psql`, `python3`; backup novo do HML na 050 e sua impressão digital); (2) se a restauração trouxer erro fora da lista aceita ou erro na reaplicação de privilégios, investigar e só ampliar a lista por revisão; (3) destino independente da segunda cópia do backup (decisão da BS); (4) se o HML receber escrita depois de 10/11/2026, refazer o inventário e a 3.6b; (5) autorização nominal da limpeza (runbook, seção 8) |
| Próxima ação exata | Revisão do PR #125 pelo responsável; nenhuma execução remota, merge ou Ready sem autorização nominal |
| Autorizações e proibições | Autorizados (sessão 02): os quatro arquivos acima, testes estáticos e ensaio local isolado (bloqueado), commit/push no PR #125 mantendo Draft. Proibidos: HML, Production, Auth, migrations, `src/`, workflows, dependências, flags, credenciais, outros PRs ou arquivos, limpeza remota, merge, Ready, force push |

### Tarefa anterior — HML-LIMPEZA-01, sessão 01 (10/11/2026, PR #125 Draft em `51d18f86b8a38519539d6d63adbe55f9b4ba371f`)

| Campo | Valor |
| --- | --- |
| Tarefa executada | HML-LIMPEZA-01 (10/11/2026): auditar o código e atualizar para a 050 o roteiro de limpeza dos dados sintéticos do HML preparado para a 045. Importados sem alteração (commit próprio) `docs/runbooks/limpeza-hml-sintetico.md`, `limpeza-hml-sintetico.sql`, `hml-impressao-digital.sql`, `scripts/hml-limpeza-ensaio-local.sh` e `scripts/hml-restaurar-local.sh` de `169f592`; adaptados em seguida. Limpeza remota NÃO executada nem autorizada |
| Resultados e testes comprovados | 045 → 050: nenhuma tabela nova (046–050 só colunas, restrições, funções e gatilhos); 046 amplia a imutabilidade da fatura e o `BEFORE TRUNCATE` de `timesheet_entries`/`invoice_items` (tratado pela desabilitação individual dos gatilhos); 047 colunas de idempotência em `billing_additionals`; 049 ação `corrected`; 050 pedido no mesmo dia. Inventário do HML (somente leitura, sessão admin, RLS de admin): 31 tabelas respondem; 10 clientes e 14 colaboradores, todos de prefixo sintético (`HML-TESTE`, `AUTH01C2`, `E2E-S11`, `E2E-S19B`, `HOMOLOG-SINT`); 0 linha fora da origem nas 21 tabelas de negócio; calendário 13 fixtures; municípios 2 (1 sintético sai, Navegantes fica); funções 5 (`e2e_s11_fn` sai); trilha 135 (7 `sistema` ficam, 128 sintéticas, só 1 apoiada no ator, que não é o admin real); motor ativo e consistente, resolução OFF. Assinatura 050 calculada do repositório: 55 versões, head `20261117120000`, md5 `01ca91361b85841984ee708716ee60ac` (a mesma regra nas 50 primeiras dá `688388431cd0e6bcc024814fceef8fcd`, a assinatura do HML 045). Script: assinatura 050; prefixo `HOMOLOG-SINT`; nova 3.6b prende as raízes ao inventário (10 clientes por ID, colaboradores por prefixo e os 5 HOMOLOG-SINT por ID); 3.6 e 3.10 trocam `NOT IN` por `(... IN ...) IS NOT TRUE` (chave nula não escapa); 3.10b bloqueia trilha sem tipo. Ensaio: expectativas 050 e novo C1b. **Ensaio local BLOQUEADO:** sem Docker, Supabase CLI e `python3`, e o backup cifrado do HML é da 045 e está em outra máquina; PostgreSQL 18 local não reproduz Supabase (não usado). Validação executada: `bash -n` dos dois scripts PASS; Prettier dos dois `.md` alterados PASS; `check:workflow` PASS; `git diff --check` PASS. SQL não executado em nenhum banco |
| Código e PR afetados | `docs/runbooks/limpeza-hml-sintetico.md`, `docs/runbooks/limpeza-hml-sintetico.sql`, `docs/runbooks/hml-impressao-digital.sql` (sem mudança), `docs/runbooks/README.md`, `scripts/hml-limpeza-ensaio-local.sh`, `scripts/hml-restaurar-local.sh` (sem mudança), `docs/HANDOFF.md`. Nenhum `src/`, migration, `package.json`, lockfile ou workflow. PR Draft desta branch contra main |
| Ambientes envolvidos | HML só lido (GET no PostgREST com a sessão do admin real, token de `qbnfcmrxmssnwkhaitgd`, e a RPC `estado_motor_vigencia`, que só lê); nada escrito, nenhum reset, nenhuma migration. App local na 3001 só como origem da sessão, encerrado; token apagado da memória da aba; `AGENTS.md` reescrito pelo `next dev` restaurado. Production, Auth, usuários, permissões, flags, `.env` e site institucional intocados |
| Pendências e decisões | (1) Ensaio local da versão 050 com 0 FAIL (Docker, Supabase CLI, `psql`, `python3`, backup novo do HML na 050 restaurado); (2) decisão da BS sobre o destino independente da segunda cópia do backup; (3) se o HML receber escrita depois de 10/11/2026, refazer o inventário e ajustar a 3.6b; (4) autorização nominal da limpeza (runbook, seção 8). Alternativa a avaliar em tarefa própria: ensaio na CI (`sql-local`) com dados sintéticos semeados, que exigiria um teste SQL novo |
| Próxima ação exata | Revisão do PR pelo responsável; nenhuma execução remota, merge ou Ready sem autorização nominal |
| Autorizações e proibições | Autorizados: leitura de código e documentação, leitura do HML, branch/worktree isolados, adaptação do runbook, ensaio local isolado (bloqueado), commit/push desta branch e um PR Draft. Proibidos: apagar ou alterar dados do HML, expurgo remoto, aplicar migrations, Production, novo Supabase, Auth/usuários/permissões, flags, regras financeiras, `src/`, `supabase/migrations/`, `package.json`, lockfile, workflows, `.env`, credenciais, force push, merge, Ready, reset remoto, site institucional |

### Tarefa anterior — DOC-01 (10/11/2026, #124 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | DOC-01 (10/11/2026): alinhar `PROGRESS.md` ao estado real depois de #119–#123. Reescritas as seções "Tarefa ativa única", "Situação", "Próxima etapa" e "Não fazer ainda", e a linha "Dependências" de "Marcos concluídos"; incluída a fila acordada com o responsável. Histórico preservado |
| Resultados e testes comprovados | Fatos conferidos por leitura: `git log origin/main` (`6fd2632` #119, `f3f846e` #120, `0db831f` #121, `7b03772` #122, `c6f9130` #123; `cad9f51` é o #117, mesclado; #118 fechado sem merge); 55 migrations, a última `20261117120000_050`; API do GitHub: 0 PRs abertos; `origin/docs/hml-limpeza-runbook` existe (`169f592`). HML 050 e flags pelo registro verificado de 09/11/2026 (não reconsultado: sem consulta ao banco nesta tarefa). `npm audit --json` (somente leitura) sobre o lockfile: 12 moderadas, 0 altas, 0 críticas, em `glob`/`minimatch` via `typescript-eslint` e `@sentry/*`. Validação: `check:workflow` PASS (inclusive `--base c6f9130 --head` do commit), links locais pelo validador, Prettier de `PROGRESS.md` PASS, `git diff --check` PASS. O HANDOFF já não passava no Prettier antes desta tarefa; não foi reformatado inteiro (fora do escopo) |
| Código e PR afetados | Apenas `PROGRESS.md` e `docs/HANDOFF.md`. PR Draft desta branch contra main |
| Ambientes envolvidos | Local (worktree, `npm ci` sem alterar `package.json`/lockfile) e CI. Nenhum código, script, dependência, banco, migration, workflow, `vercel.json`, `.env`, HML ou Production tocado |
| Pendências e decisões | Fila: (2) auditoria do código e roteiro de limpeza do HML para a 050; (3) limpar o HML e teste manual do zero; (4) ajustes do teste manual, incluindo UX-FATURA-02; (5) Production `pg_dump` + 035–050 com autorização nominal; (6) piloto. Decisões de negócio: tipos de serviço avulso, modalidade de cobrança, pagamento por pessoa ou rateio; Dynamis (intervalo do dia útil, saída antecipada, sábados acima de 4h); C1–C6. Dívida técnica: as 12 moderadas do `npm audit`, PR próprio depois do piloto, nunca `npm audit fix --force` |
| Próxima ação exata | Conferir CI do HEAD do PR; revisão do usuário; nenhuma promoção a Ready ou merge sem autorização nominal |
| Autorizações e proibições | Autorizados: worktree/branch, edição de `PROGRESS.md` e `docs/HANDOFF.md`, commit/push desta branch e um PR Draft. Proibidos: código, scripts, banco, migrations, dependências (`npm audit fix`, `npm update`, `package.json`/lockfile), workflows, `vercel.json`, `.env`, HML, Production, merge, Ready, force push, outro PR |

### Tarefa anterior — UX-FATURA-01 (10/11/2026, #123 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-FATURA-01 (10/11/2026): na tela Faturamento, "Gerar fatura" deixa de emitir na hora e abre um `AlertDialog` de confirmação com cliente, período, quantidade de apontamentos e de adicionais incluídos, total a faturar (dados que a tela já tinha, sem consulta nova) e o aviso "A fatura emitida não pode ser alterada nem apagada." Botões "Cancelar" (foco inicial) e "Emitir fatura"; só "Emitir fatura" chama `generate.mutate()` |
| Resultados e testes comprovados | RED → GREEN em `scripts/testar-interface-simples.mjs` (C8–C15: 8 falharam antes, 40/0 depois). Em andamento, os dois botões ficam desabilitados e o diálogo não fecha (`onOpenChange` ignora com `generate.isPending`); dupla emissão bloqueada por `emitindoRef` antes do `mutate` e `event.preventDefault()` na ação; diálogo fecha em `onSettled`. Windows, Node 26.13, sobre `7b03772` + diff: `npm run lint`, `npx tsc --noEmit`, `check:workflow`, `check:vercel-deployments`, `npm run build` e `git diff --check` PASS; 69/72 `test:*`, as 3 de ambiente com contagens idênticas (`calendario-runners` 10/13, `workflow` 7/1, `vercel-deployments` 0/22). Navegador (app do worktree em `localhost:3001`, CSP → `qbnfcm…`, admin, só leitura): HOMOLOG-SINT-AV2, 01–15/11, total R$ 150,00 → "Gerar fatura" abriu "Emitir fatura?" com Cliente HOMOLOG-SINT-AV2, Período 01/11/2026 a 15/11/2026, Apontamentos 1, Adicionais 0, Total a faturar R$ 150,00, o aviso e foco em Cancelar; cancelado: diálogo fechado, 7 faturas antes e depois (também após recarregar), nenhuma do HOMOLOG-SINT-AV2, total a faturar segue R$ 150,00 |
| Código e PR afetados | `src/app/(painel)/faturamento/painel-faturamento.tsx`, `scripts/testar-interface-simples.mjs`, `docs/HANDOFF.md`. PR Draft desta branch contra main |
| Ambientes envolvidos | Local (worktree, `npm ci`, `next dev` na 3001 lendo o `.env` existente sem alterá-lo, encerrado) e CI. HML só lido: nenhuma escrita, nenhuma fatura emitida. Production, banco, RPC `gerar_fatura`, cálculo, `billing.ts`, `.env` intocados. `AGENTS.md` reescrito pelo `next dev`: restaurado, fora do commit. Prints no scratchpad da sessão (`ux-fatura/prints`) |
| Pendências e decisões | UX-FATURA-02: apontamento faturado sem rótulo "Faturado", folha "Aberto" e "Salvar"/"Fechar dia" habilitados. Observação: em tela estreita o rodapé do diálogo empilha "Emitir fatura" acima de "Cancelar" (padrão do componente); o foco inicial continua em Cancelar. Atritos anteriores e decisões de negócio dos avulsos seguem abertos |
| Próxima ação exata | Conferir CI do HEAD do PR; revisão do usuário; nenhuma promoção a Ready ou merge sem autorização nominal |
| Autorizações e proibições | Autorizados: worktree/branch, `npm ci`, `painel-faturamento.tsx` e o teste estrutural, navegador só para olhar e cancelar, commit/push desta branch e um PR Draft; Preview automático (não é homologação). Proibidos: banco, migrations, RLS, grants, flags, cálculo, faturamento (RPC e regras), `billing.ts`, auth/MFA, `vercel.json`, workflows, `.env`, chave de serviço, escrita no HML, emitir fatura, Production, rótulo "Faturado" (UX-FATURA-02), merge, Ready, force push, outro PR |

### Tarefa anterior — UX-AVULSA-03 (10/11/2026, #122 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-AVULSA-03 (10/11/2026): na tela Nova operação, com motor por vigência ligado e contrato escolhido, o campo "Valor acordado por diária (avulsa)" passa a ficar desabilitado e vazio, `agreed_amount` não vai no payload e aparece "O valor vem do contrato. Para um valor próprio deste serviço, deixe o contrato em branco." Sem contrato, segue a vigência inicial ("Cadastro inicial da operação"); edição de operação existente inalterada |
| Resultados e testes comprovados | RED → GREEN em `scripts/testar-interfaces-vigencia.mjs` (G8b–G8g: 5 falharam antes, 157/0 depois; G8 e `testar-valores-operacao` E1 preservados, 146/0). Windows, Node 26.13, sobre `0db831f` + diff: `npm run lint`, `npx tsc --noEmit`, `check:workflow`, `check:vercel-deployments`, `npm run build` e `git diff --check` PASS; 69/72 `test:*` PASS, as 3 de ambiente com contagens idênticas (`calendario-runners` 10/13, `workflow` 7/1, `vercel-deployments` 0/22). Navegador (app do worktree em `localhost:3001`, CSP → `qbnfcm…`, admin): (a) PASS na tela — R$ 150 digitado e contrato `HOMOLOG-SINT-AV Contrato` escolhido: campo limpo e desabilitado com a ajuda; salvar NÃO executado (criaria operação além da autorizada; salvar com contrato sem valor já provado na HML-AVULSO-01), formulário cancelado. (b) PASS — `Contagem de palete - HOMOLOG-SINT-AV2`, avulsa sem contrato, R$ 150,00, 10/11/2026: cartão "Valor acordado R$ 150,00", histórico com vigência 10/11/2026 em aberto, "Informada · Cadastro inicial da operação". (c) PASS — `HOMOLOG-SINT-AV2 Colaborador 1` sem turno, 08:00–17:00/60 min = 8h00 R$ 150,00 (diária de referência R$ 150,00, "Vigência do valor acordado"), custo R$ 100,00, conferido após recarregar. (d) PASS — Fechamento 01–15/11 HOMOLOG-SINT-AV2: receita R$ 150,00, custo R$ 100,00, resultado R$ 50,00 (33,3%), conciliação "Confere" nas 6 parcelas |
| Código e PR afetados | `src/app/(painel)/operacoes/painel-operacoes.tsx`, `scripts/testar-interfaces-vigencia.mjs`, `docs/HANDOFF.md`. PR Draft desta branch contra main |
| Ambientes envolvidos | Local (worktree, `npm ci`, `next dev` na 3001 lendo o `.env` existente sem alterá-lo, encerrado) e CI. HML, escrita sintética pelas telas: cliente `HOMOLOG-SINT-AV2`, colaborador `HOMOLOG-SINT-AV2 Colaborador 1` (R$ 100 desde 01/11; criado por decisão do usuário porque os dois `HOMOLOG-SINT-AV` estavam alocados e 0 disponíveis), operação `Contagem de palete - HOMOLOG-SINT-AV2` com vigência inicial, alocação sem turno, 1 apontamento de 10/11. Nenhuma fatura; nenhum registro existente, conta, papel, Configurações, Implantação de vigências ou flag alterado. `AGENTS.md` reescrito pelo `next dev`: restaurado, fora do commit. Prints no scratchpad da sessão (`ux-avulsa-03/prints`) |
| Pendências e decisões | Decisões de negócio dos avulsos: lista de tipos de serviço, unidade e modalidade de cobrança (diária, unidade, valor fechado como adicional), remuneração por pessoa ou rateio. Atritos já registrados (sem turno com horários vazios, "Localidade ausente" que não bloqueia, "Gerar fatura" sem confirmação, faturado sem rótulo) seguem abertos |
| Próxima ação exata | Conferir CI do HEAD do PR; revisão do usuário; nenhuma promoção a Ready ou merge sem autorização nominal |
| Autorizações e proibições | Autorizados: worktree/branch, `npm ci`, formulário de operação e o teste estrutural correspondente, escrita sintética `HOMOLOG-SINT-AV2` descrita acima (sem fatura), commit/push desta branch e um PR Draft; Preview automático (não é homologação). Proibidos: banco, migrations, RLS, grants, flags, cálculo, precedência de preços, faturamento, `billing.ts`, auth/MFA, `vercel.json`, workflows, `.env`, chave de serviço, alterar registros existentes, contas, Configurações, Implantação de vigências, emitir fatura, Production, merge, Ready, force push, outro PR |

### Tarefa anterior — HML-AVULSO-01 e botão escondido (09/11/2026, #121 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | HML-AVULSO-01 (09/11/2026): homologação de telas do cenário 10, fluxo avulso de ponta a ponta, app do worktree `bslogistica-ux-menu` em `c32a93f` (#121) em `localhost:3001` (CSP → `qbnfcm…`), admin `bcviniciuslc@gmail.com` sem MFA, resolução comercial OFF |
| Resultados e testes comprovados | **8 PASS, 1 PARCIAL.** a PASS: cliente `HOMOLOG-SINT-AV` e contrato `HOMOLOG-SINT-AV Contrato` (R$ 200,00, 8h, 1,5x, tolerância 10 min, vigência 01/11/2026). b PASS: `HOMOLOG-SINT-AV Colaborador 1/2`, custo R$ 100/110 desde 01/11. c **PARCIAL**: operação avulsa `Descarga de container – HOMOLOG-SINT-AV` (`622cbc76…`), data 09/11/2026, contrato selecionado; com "Valor acordado por diária (avulsa)" = 200 o salvamento foi recusado ("Com o motor por vigência ligado, taxa, custo ou valor acordado só entram por registro de vigência (data de início e motivo), não por INSERT direto."), nada gravado; salva sem o valor, a diária R$ 200 veio do contrato. d PASS: 2 colaboradores alocados "Sem turno". e PASS: sem turno, 08:00–17:00/60 min = 8h00 R$ 200,00; 08:00–18:30/60 min = 9h30, HE 1h30 R$ 56,25 (200 ÷ 8 = 25,00 × fator 1,5 = 37,50 × 1,5 h = 56,25), total R$ 256,25; custo R$ 100,00 + R$ 130,63; conferido após recarregar. f PASS: Fechamento 01–15/11 receita R$ 456,25, custo R$ 230,63, resultado R$ 225,62 (49,5%), conciliação "Confere" nas 6 parcelas. g PASS: Excel do cliente (2 abas) sem custo/margem/resultado, total R$ 456,25. h PASS: fatura única HOMOLOG-SINT-AV R$ 456,25 / custo R$ 230,63 "Fechada", sem ação de edição; apontamentos faturados com 6 campos desabilitados, "Corrigir" ausente, Salvar → "Nenhuma alteração para salvar". i PASS (observação): botão "Adicionar serviço de container" no cartão da avulsa leva a `/containers/novo?operacao=622cbc76…`, formulário "Novo serviço de containers" com cliente e operação pré-preenchidos (não salvo) |
| Código e PR afetados | Nenhum código alterado. Apenas este HANDOFF, local, na branch do #121 (sem commit) |
| Ambientes envolvidos | HML, escrita sintética autorizada só pelas telas: cliente, contrato, 2 colaboradores, operação avulsa `622cbc76…`, alocação sem turno, 2 apontamentos de 09/11, 1 fatura (imutável). Nenhum registro existente, conta, papel, Configurações, Implantação de vigências ou flag alterado; operação não atribuída a conta operacional. Production, código, `.env` e `vercel.json` intocados. `next dev` reescreveu `AGENTS.md`: restaurado. Prints e o Excel fora do repositório (scratchpad da sessão, `hml-avulso-01`) |
| Pendências e decisões | (1) Campo "Valor acordado por diária (avulsa)" aparece na criação mas é recusado com o motor por vigência ligado: esconder/desabilitar ou levar ao registro de vigência com motivo. (2) Botão "Adicionar serviço de container" em toda operação abre o módulo Containers (valor negociado + custo por participante): risco de cobrar o mesmo serviço duas vezes (diárias + container); recomendação: esconder no cartão (ou redirecionar para adicional no Faturamento) enquanto o módulo fica só por URL; o formulário ainda mostra "Voltar para containers", tela que saiu do menu. (3) Atritos: colaborador nasce com "Revisar função"; sem turno, horários vêm vazios e intervalo 0 (preencher à mão em cada linha); operação mostra "Localidade ausente. Defina a vigência antes de apontar com o motor ligado." mas o apontamento foi aceito; apontamento faturado sem rótulo "Faturado", folha "Aberto", Salvar/Fechar dia habilitados; "Gerar fatura" sem confirmação; nome com "–" (travessão) difícil de digitar. Decisões de negócio abertas: tipos de serviço, unidade/modalidade, remuneração |
| Próxima ação exata | Ponto (2) decidido pelo usuário: esconder o botão, feito localmente (ver abaixo). Falta decidir o ponto (1). #121 segue Draft até autorização nominal de merge |
| Complemento — botão escondido (09/11/2026) | Decisão do usuário: esconder "Adicionar serviço de container". Removidos o `Button`/`Link` do cartão da operação e o import `Link` (sem outro uso) em `painel-operacoes.tsx`; `scripts/test-container-telas.mjs` passa a exigir a ausência do atalho. Rota `/containers/novo?operacao=` e links do Faturamento mantidos. Windows sobre `c32a93f` + diff local: lint, tsc, check:workflow, check:vercel-deployments, build e diff --check PASS; `test:container-telas` 65/0; 69/72 `test:*` (as 3 de ambiente de sempre). Navegador localhost:3001 → HML, admin, sem salvar: 8 cartões de operação sem o botão e sem link para `/containers`; `/containers` abre por URL com 11 serviços. Publicado no #121 por autorização do usuário |
| Autorizações e proibições | Autorizada e concluída: escrita sintética `HOMOLOG-SINT-AV` no HML pelas telas, incluindo uma fatura. Proibidos: alterar registros existentes, contas, papéis, Configurações, Implantação de vigências, flags, código, banco, migrations, `.env`, `vercel.json`, commit/push/merge/PR, Production, atribuição a conta operacional |

### Tarefa anterior — UX-AVULSA-02 (09/11/2026, PR #121 Draft)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-AVULSA-02 (09/11/2026): retirar o item "Containers" da navegação lateral do admin. Decisão do responsável: serviço de container passa a ser registrado como operação avulsa em Operações (nome do serviço, equipe e diária). Nada apagado: rotas, ações, componentes, migrations 045–050 e dados de containers permanecem |
| Resultados e testes comprovados | `src/app/(painel)/_components/app-shell.tsx`: removido `{ href: "/containers", label: "Containers", icon: Package }` e o import `Package`, sem outro uso (o lint reprovaria). Expectativas que conferiam o item: `scripts/testar-papel.mjs` E5 9 → 8 links, `TELAS_NAV` exclui `containers` como já excluía `usuarios` (a rota segue em `TELAS`, com guard e rota conferidos) e nova E5c "containers NÃO é item da navegação principal"; `scripts/testar-tela-operacional.mjs` B15 9 → 8. Windows, Node 26.13: `npm run lint` PASS, `npx tsc --noEmit` PASS, `check:workflow` PASS, `check:vercel-deployments` PASS, `test:papel` 111/0, `test:tela-operacional` 170/0, 69/72 `test:*` PASS, `npm run build` PASS, `git diff --check` PASS. Falham por ambiente Windows, iguais às da UX-AVULSA-01: `test:calendario-runners` 10/13, `test:workflow` 7/1, `test:vercel-deployments` 0/22. Navegador (app do worktree em `localhost:3001`, CSP → `qbnfcm…`, admin): menu com Dashboard, Apontamentos, Operações, Clientes e contratos, Colaboradores, Faturamento, Fechamento, Relatórios; `/containers` abre por URL direta com 11 serviços; Nova operação → tipo "Avulsa" mostra valor acordado por diária e data; cancelado, cartão Avulsas segue em 1 |
| Código e PR afetados | `src/app/(painel)/_components/app-shell.tsx`, `scripts/testar-papel.mjs`, `scripts/testar-tela-operacional.mjs`, `docs/HANDOFF.md`. PR Draft desta branch contra main |
| Ambientes envolvidos | Local (worktree, `npm ci`, `next dev` na porta 3001 lendo o `.env` existente sem alterá-lo, encerrado ao fim) e CI. HML só lido. Nenhum banco, Production, `.env`, chave de serviço, flag, migration, cálculo, faturamento, auth, `vercel.json` ou workflow tocado. O `next dev` reescreve `AGENTS.md` com bloco "nextjs-agent-rules": restaurado, fora do commit |
| Pendências e decisões | Links restantes para `/containers`, mantidos de propósito: `faturamento/adicionais.tsx` (import de `../containers/_acoes`, `router.push` linha ~144 e `href` linha ~336) e `operacoes/painel-operacoes.tsx` linha ~701 (botão "Adicionar serviço de container" → `/containers/novo?operacao=…`). Testes que referenciam rotas `/containers` seguem válidos (`test-container-telas`, `test-container-dados`, `testar-func-ready`, `testar-compatibilidade-deploy`). Decisões abertas: lista de tipos de serviço, unidade e modalidade de cobrança dos avulsos (diária, unidade, valor fechado como adicional), remuneração por pessoa ou rateio, destino final do módulo Containers. Pendentes anteriores abaixo seguem válidos |
| Próxima ação exata | Concluída: PR #121 Draft, CI validar/sql-local SUCCESS em `c32a93f` |
| Autorizações e proibições | Autorizados: worktree/branch, `npm ci`, remoção do item de menu e das expectativas que o conferiam, commit/push desta branch e um PR Draft; Preview automático (não é homologação). Proibidos: banco, migrations, RLS, grants, flags, cálculo/faturamento, auth/MFA, `vercel.json`, workflows, apagar/alterar rotas, ações, componentes ou dados de containers, remover os links listados, escrita no HML, Production, `.env`, chave de serviço, merge, Ready, force push, outro PR |

### Tarefa anterior — UX-AVULSA-01 (09/11/2026, #120 mesclado)

| Campo | Valor |
| --- | --- |
| Tarefa executada | UX-AVULSA-01 (09/11/2026): trocar três textos da tela Operações que prendiam a avulsa a "carga e descarga". O tipo do serviço avulso passa a ser dito pelo nome da operação (decisão do responsável). Menu e módulo "Containers" inalterados |
| Resultados e testes comprovados | Trocas: (1) `painel-operacoes.tsx`, opção do tipo "Avulsa (carga/descarga)" → "Avulsa"; (2) `painel-operacoes.tsx`, cartão "Avulsas" description "Carga e descarga" → "Serviços pontuais"; (3) `operacoes/page.tsx`, metadata description → "Operações fixas e avulsas, com turnos, intervalos e equipe alocada." (uma linha, exigência do Prettier corrigida à mão). Nenhuma suíte conferia os textos antigos. Windows, Node 26.13: `npm run lint` PASS, `npx tsc --noEmit` PASS, `check:workflow` PASS, `check:vercel-deployments` PASS, 69/72 `test:*` PASS, `npm run build` PASS (66 s, 24 páginas), `git diff --check` PASS. Falham `test:calendario-runners` (Python ausente), `test:workflow` (separador `\`) e `test:vercel-deployments` (caminho `C:\C:\…PC%20CASA`) com contagens idênticas no checkout original em `d0e7143` sem a mudança: ambiente Windows, a confirmar na CI Linux |
| Código e PR afetados | `src/app/(painel)/operacoes/painel-operacoes.tsx`, `src/app/(painel)/operacoes/page.tsx`, `docs/HANDOFF.md`. PR Draft desta branch contra main, incluindo os 3 commits de documentação herdados |
| Ambientes envolvidos | Local (worktree, `npm ci`) e CI. Nenhum banco, HML, Production, `.env`, chave de serviço, flag, migration, cálculo, faturamento, auth, `vercel.json` ou workflow tocado |
| Pendências e decisões | Evolução dos serviços avulsos: lista de tipos reais, unidade/modalidade de cobrança (diária, unidade, valor fechado), se toda avulsa é por diária, remuneração por pessoa ou rateio, futuro do menu "Containers". Outras ocorrências não alteradas (fora do escopo): `painel-operacoes.tsx` "Operações fixas usam turnos diários; avulsas registram data e valor acordado." e "Valor acordado por diária (avulsa)"; `operacoes/page.tsx` openGraph "Operações fixas e avulsas com turnos e equipe alocada."; dashboard "Distribuição entre operações fixas e avulsas."; `/containers` "Serviços avulsos, valores negociados e custos por participante." Nenhuma outra menção de interface a carga/descarga em `src/` ou `scripts/`. Pendentes anteriores abaixo seguem válidos |
| Próxima ação exata | Concluída: CI validar/sql-local SUCCESS em `5cec5cf` e `9eb628f`; #120 mesclado pelo usuário em `f3f846e` |
| Autorizações e proibições | Autorizados: worktree/branch, `npm ci`, os três textos, commit/push desta branch e um PR Draft; Preview automático (não é homologação). Proibidos: banco, migrations, RLS, grants, flags, cálculo/faturamento, `billing.ts`, auth/MFA, `vercel.json`, workflows, HML, Production, `.env`, chave de serviço, módulo/menu "Containers", tipo/unidade/quantidade de serviço, merge, Ready, force push, outro PR |

### Tarefa anterior — homologação da interface (09/11/2026)

| Campo | Valor |
| --- | --- |
| Tarefa executada | Homologação funcional da interface dos 9 cenários (09/11/2026), app Next local (`localhost:3000`, `.env` → HML `qbnfcmrxmssnwkhaitgd`), navegador do app; admin `bcviniciuslc@gmail.com` (sem MFA) nos cenários 1–8 e `s11-op@e2e-sintetico.invalid` no 9. Preview não usado (exige login Vercel; vínculo não comprovado) |
| Resultados e testes comprovados | **9/9 PASS** (prints na sessão). 1 Dashboard abre com R$. 2 container pedido = execução (09/11) salvo. 3 pedido 10/11 > execução 09/11 recusado na tela ("A solicitação não pode ser posterior à execução."), lista continua com 10 serviços. 4 correção 300 → 320: novo `6872ba95…` disponível, original `a3cf5ae1…` Cancelado/substituído com vínculo e auditoria. 5 adicional R$ 75 com duplo clique: um só. 6 8h = R$ 250,00; 9h30 = R$ 320,31 (HE R$ 70,31), custo R$ 120,00 e R$ 154,38, conferido após recarregar. 7 Fechamento 01–15/11 R$ 965,31, conciliação com banco "Confere" em todas as parcelas; Excel do cliente (2 abas) sem custo/margem/resultado, total R$ 965,31. 8 fatura `c40428d0…` R$ 965,31/custo R$ 324,38 Fechada; sem ação de edição; container faturado sem Corrigir/Cancelar e `/corrigir` recusado; apontamento faturado com campos desabilitados ("Nenhuma alteração para salvar"). 9 operacional entra em `/operacional`, vê só "E2E-S11 Operação A1", nenhum `R$`/termo financeiro na página, menu só `/operacional`; `/dashboard` redireciona para `/operacional`; `/faturamento` e `/fechamento` mostram "Área administrativa restrita". Somado à camada banco/RPC anterior (38/38 PASS) |
| Código e PR afetados | Nenhum código alterado. Apenas este checkpoint, local |
| Ambientes envolvidos | HML com escrita sintética autorizada e persistida: cliente `HOMOLOG-SINT-UI` (`a7c38a8c…`), contrato `HOMOLOG-SINT Contrato UI` (R$ 250, 8h, 1,5, vigência 01/11/2026), colaboradores `HOMOLOG-SINT Colaborador 1/2` (custo R$ 120/130 desde 01/11), operação `HOMOLOG-SINT Operacao UI` (`4a5a47dc…`) e turno, 2 containers, 1 adicional, 2 apontamentos de 09/11, fatura `c40428d0…` (imutável). Nenhum registro existente alterado; contas de usuário, Configurações e Implantação de vigências intocadas; resolução comercial OFF. Production não tocada |
| Pendências e decisões | Observações de UX (não reprovam cenário): "Gerar fatura" emite sem confirmação; apontamento faturado não exibe "Faturado", folha segue "Aberto" e "Salvar"/"Fechar dia" ficam habilitados; cenário 3 recusado no cliente antes do servidor (recusa do banco provada na rodada banco/RPC); aviso "Localidade ausente" na operação não bloqueou apontamento. Download do Excel no navegador do app ficou como `.tmp` em Downloads. Pendentes anteriores: Production 034 → 050 com `pg_dump`; três particularidades da Dynamis; prévia `src/lib/billing.ts` `<= 15`/`<= 45` × banco `< 15`/`< 45`; dados `HOMOLOG-SINT` no HML exigem tarefa própria se for limpar |
| Próxima ação exata | Superada pela UX-AVULSA-01 acima (checkpoint publicado nesta branch por autorização do usuário) |
| Autorizações e proibições | Autorizada naquela tarefa: escrita sintética `HOMOLOG-SINT` no HML pelas telas, incluindo uma fatura. Não se estende a outras escritas |

## Próxima ação exata, na conta nova

1. Ler `CLAUDE.md`, `AGENTS.md`, este HANDOFF e `PROGRESS.md`; conferir main, PRs e HML (somente leitura).
2. Interface dos 9 cenários concluída em localhost → HML (9/9 PASS).
3. Para Production: `pg_dump` completo novo, token com acesso ao projeto de Production, janela e autorização nominal antes de aplicar 035–050.

## Segurança e limites da transferência

- Nenhuma senha, token ou `.env` real no Git. O token Supabase desta sessão está salvo no ambiente Default do Claude Code e só enxerga o HML.
- CI SUCCESS, Preview READY, migration aplicada, flag ON, HML homologado e Production liberada são estados distintos.
- As seções históricas abaixo preservam registros datados; não são instruções vigentes.

## Autorizações

Escritas sintéticas `HOMOLOG-SINT`, `-AV` e `-AV2` concluídas, não vigentes. #119–#124 mesclados pelo usuário. HML-LIMPEZA-01 (vigente, sessão 03): correção da guarda de destino em `scripts/hml-limpeza-ensaio-local.sh`, `limpeza-hml-sintetico.md` e deste HANDOFF, verificações estáticas e com stubs, commit/push no PR #125 (branch `docs/hml-limpeza-050`), mantido Draft. Não cobre reset de banco nem o ensaio. As sessões 01 e 02 cobriram a leitura do HML, a adaptação para a 050 e a correção das verificações com NULL. Não cobre a limpeza remota, que exige autorização nominal própria (runbook, seção 8).

## Proibições

Sem deploy ou migration em Production, escrita ou expurgo no HML, reset remoto, emissão de fatura, resolução de tarifas ON, dados reais, mudança de dependências, Auth/usuários/permissões, criação de ambiente/Supabase, reaplicação de migrations, Gates 3–5 do checkpoint automático, merge ou Ready do PR da HML-LIMPEZA-01 sem autorização nominal.

## Retomada

Abrir `CLAUDE.md`, `AGENTS.md`, este HANDOFF e `PROGRESS.md`; conferir refs, CI e HML por leitura. As seções históricas abaixo não transferem autorização.

## Evidência automática de Preview

<!-- checkpoint-preview:start -->
Controlador instalado desativado: false &&, contents: read, --dry-run e flag OFF.
Gates 3–5 PAUSADOS. Nenhum recibo automático ou execução ativa autorizado.
<!-- checkpoint-preview:end -->

## Evidências

### RETOMADA-FUNCIONAL-01 — consolidação documental

#116 Ready/revisões/checks reconferidos sem bloqueio; squash do HEAD nominal
`ccfba1ab5629aa20200959ce8ab74532fa8b9f71`, base
`92478763af9674ecd327333020ea2a6f240ee404`, em 2026-11-09T11:55:57Z.
Nova main `75c47cd9a30e4888b197ca6ae27aa236c71ec589`, árvore idêntica ao candidato e quatro documentos.
[CI da nova main](https://github.com/therunnas/bslogistica/actions/runs/42612890409): validar/sql-local SUCCESS, controlador checkpoint
SKIPPED. Sem --admin, auto-merge, force push ou commit adicional na main.

Comparação paginada limitada a este merge, sem repetir auditoria: seis amostras,
217 deployments totais, mesmos43 Production; nenhum deployment do squash em qualquer
target/estado. Servido dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4, SHA38b43490a8e0913c62a4ee6047ef48a8288ca0dc,
aliases/domínios/proteção/Git preservados. main:false/Next.js e controlador
false &&/contents: read/--dry-run/flag ausente OFF continuam vigentes.

### RETOMADA-FUNCIONAL-01 — negócio e implementação

Resultado completo,17 itens, fontes por SHA, impacto/prioridade, aceite,
dependências/decisões e lotes: [matriz revisada](NEGOCIO_X_SISTEMA.md).

- Fonte de negócio: responsável em 08/11 no #112; cinco práticas ainda não
  confirmadas e a nova decisão comercial048 não foram inventadas pelo executor.
- #111/#112 continuam abertos Draft nos HEADs acima, CI atual SUCCESS e conflitos
  de integração. Não foram mergeados nem tiveram branches atualizadas.
- A main não mudou src/supabase desde38b, base da matriz antiga. #111 adiciona
  melhorias/correções e046–049 sem significar schema no HML ou Production.
- Correções do diagnóstico: função operacional já tem texto livre e catálogo
  extensível(quatro iniciais); Excel real/Dynamis têm evidências S13/S14. Não
  duplicar funções existentes nem reaplicar homologação histórica ao candidato.
- Divergência objetiva: pedido e execução no mesmo dia ainda são recusados por
  domínio/normalizador/constraint045, na main e no #111. D06 antigo validava essa
  recusa sob regra superada; a primeira correção proposta deve mudar esse aceite.
- Resolução comercial OFF não usa diária individual/tarifa na cobrança. A048
  propõe fallback quando ON e exige decisão comercial, aplicação e homologação
  próprias. Código local/CI e HML com045/flagsOFF são estados diferentes.
- 27 casos históricos FIN-PR-13 têm evidências mistas(HML/Excel e e-mail A05 local)
  e não aprovam todo #111; S19 mantém NO-GO global,
  283 PASS/64 BLOQUEADO/137 NÃO TESTADO. Sem novo teste de tela/banco nesta tarefa.

### Histórico AUTO-12 e anteriores — preservar escopos

Registros abaixo são históricos; próximas ações de Gate 3 neles contidas estão
PAUSADAS pela RETOMADA-FUNCIONAL-01. Não são autorização vigente de execução.

### AUTO-12 — preflight e squash

- Preflight remoto: main b26b6d8a93c71d30f26b52dbe7da02e34a10ee4b, #115 fda7fcc9df7b64d0393852c9cc5256624a7b9b52,
  mergeable/CLEAN, mesmos 17 arquivos/blobs, CI e Preview do próprio HEAD READY
  (`dpl_DoU8FnEvKPHnJ8kE5zzsXKBzQCRU`). Sem app, SQL/migration, dependência nova,
  alteração de vercel.json ou release #111/#112.
- Ready em 2026-11-09T04:05:15Z; reconsulta de checks/reviews/threads sem pendência
  ou bloqueio. CodeRabbit status success não é aprovação humana de código;
  revisão independente do mesmo candidato já constava da AUTO-11, sem repeti-la.
- Squash [#115](https://github.com/therunnas/bslogistica/pull/115),
  em 2026-11-09T04:07:30Z: `92478763af9674ecd327333020ea2a6f240ee404`, pai `b26b6d8a93c71d30f26b52dbe7da02e34a10ee4b`,
  árvore `a6e7ce724145aa7e52e8e59a49d9fb40f51b6675` idêntica ao candidato. Sem --admin, auto-merge,
  force push ou commit direto adicional na main. Os 17 arquivos foram reconferidos.
- [CI da nova main](https://github.com/therunnas/bslogistica/actions/runs/42560037734): validar/sql-local SUCCESS. Validação local nova:
  56 casos (26 automação/8 documentais/22 política Vercel), contrato/links,
  main:false, YAML/permissões/checkout confiável, composição CI/dependências e
  diff --check PASS. CI executou as verificações completas da nova main; os
  resultados locais 70 suítes/lint/TypeScript/build do AUTO-11 são históricos.

### AUTO-12 — Production e ausência de escrita

Baseline completa pré-merge: 216 deployments / 3 páginas, 43 Production.
Sete leituras completas pós-merge, com última leitura Vercel em 2026-11-09T04:12:39Z
(309 s após squash). O processo incluiu outras consultas GitHub e encerrou a
última amostra composta em 2026-11-09T04:12:44Z, 315,0 s medidos após merge.
É amostragem delimitada, não garantia contínua/infinita.

| Evidência | Antes | Depois |
| --- | --- | --- |
| Total deployments | 216 | 216 |
| Production (todos os estados) | 43 IDs | Os mesmos 43 IDs, zero novo/removido |
| Servido | dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4 | Idêntico |
| SHA servido | 38b43490a8e0913c62a4ee6047ef48a8288ca0dc | Idêntico |
| Deployment do squash | Nenhum | Nenhum target/estado, inclusive staged/failed/cancelled |
| Domínios/aliases/proteção/Git | Baseline | Idênticos |
| Refs publicadas | Baseline | Somente main avançou pelo squash autorizado |
| Recibos automáticos | Nenhum na árvore candidata | Nenhum novo |

Aliases preservados: admin.bslogisticas.com.br,
bs-logistica-sistema-bslogisticas.vercel.app,
bs-logistica-sistema-git-main-bslogisticas.vercel.app e
bs-logistica-sistema-gold.vercel.app. Production Branch main, conexão Git,
proteção all_except_custom_domains, overrides e hooks sem divergência.
Nenhum deployment/ajuste administrativo executado. Zero incidente operacional.
Nenhum commit publicado pelo controlador: refs comparadas, main sem avanço além
do squash, #111/#112/candidato preservados e job sem passos. Este registro manual
posterior em branch própria é autorizado e não é recibo automático.

### AUTO-12 — instalação e evento observado

Os dois arquivos estão na branch padrão: checkpoint-preview.yml e
checkpoint-preview-signal.yml. A API registra os workflows como state active;
isso significa definição registrada, não controlador operacionalmente ativado.
O bloqueio versionado false && e a flag OFF mantêm o job desligado.

[Evento workflow_run observado](https://github.com/therunnas/bslogistica/actions/runs/42560278574), run 42560278574,
SHA `92478763af9674ecd327333020ea2a6f240ee404`, branch main, criado em 2026-11-09T04:10:07Z:
workflow Checkpoint Preview e job checkpoint **SKIPPED**, zero steps.
A API comprova o estado; a condição false && é sempre falsa e a flag estava
verdadeiramente ausente/OFF. Não houve checkout, token de job exercido ou CLI
executada; permissões read são as declaradas, sem afirmar teste efetivo do token.
Sem dry-run hospedado ativo, escrita ou recibo. Nenhum evento foi fabricado.

Travas reconferidas no código da main: false &&, contents/actions/deployments/
pull-requests read, --dry-run, flag ausente/OFF, sinal com permissions vazio e sem
checkout/escrita, controlador confiável github.workflow_sha e persist-credentials
false. Default workflow permissions do repositório read; nenhum segredo/variável
ou credencial criado. Gate 1/vercel.json/Next.js/lockfile e controles preservados.

Fechamento documental desta branch: 34 casos (automação/contrato documental)
reexecutados PASS, links canônicos e diff --check PASS; revisão independente
sem bloqueio importante. A precisão entre horário da Vercel e duração agregada
foi corrigida sem repetir o ensaio. CI/Preview desta documentação têm SHA e
checks próprios a consultar no GitHub, sem commit recursivo somente de status.

### Histórico AUTO-11 e anteriores — preservar datas e escopos

Os registros seguintes pertencem às suas etapas. Expressões como candidato,
ausente da main ou merge não autorizado descrevem a situação daquela data;
foram superadas somente pela integração nominal AUTO-12 acima. Não são autorização
vigente nem prova de Gate 3, escrita ou homologação funcional.

### AUTO-11 — consolidação documental comprovada

- #114 ajustou somente referências transitórias em HANDOFF, PROGRESS e ESTADO;
  HEAD final `0917e0c16e8480bcb74e7a638027e91dfd961c26`, três blobs remotos
  conferidos, CI/Preview próprios aprovados, Ready e nenhuma revisão/thread
  bloqueante. CodeRabbit não produziu aprovação de código (política do serviço).
- Squash em 2026-11-09T03:23:27Z: `b26b6d8a93c71d30f26b52dbe7da02e34a10ee4b`,
  pai `2561b919da5ab31e0ed1882864ee069b9961b6f7`, árvore idêntica ao candidato.
  [CI da nova main](https://github.com/therunnas/bslogistica/actions/runs/42556140779):
  validar e sql-local SUCCESS, sem supressão de checks ou --admin.
- Leituras completas/paginadas antes e após o squash, até 03:26:42Z (191,3 s):
  215 deployments totais, mesmos 43 Production, zero deployment associado ao
  squash em qualquer target/estado, Git e main:false preservados. Servido
  `dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4`, SHA
  `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`, mesmos aliases/domínios/proteção.
  É verificação desta consolidação, não nova homologação ou repetição do AUTO-10B.

### AUTO-11 — composição mínima do Gate 2

Branch criada de b26b6d8, fonte seletiva #111
`7e08270011f74ea5dfe4470097f58659eea81140`. Sem merge/cherry-pick de release,
sem app, SQL/migrations, lockfile, documentos de negócio #112 ou nova dependência.
O [guia técnico](continuidade/CHECKPOINT_AUTOMATICO.md) descreve os componentes,
limites e o plano do Gate 3. HANDOFF permanece entrada única de continuidade;
AGENTS/CLAUDE compartilham contrato literal de sete campos por tarefa.

Workflows permanecem com **false &&, contents: read, --dry-run e flag OFF**.
Sinalizador sem checkout/escrita; controlador usa github.workflow_sha confiável,
sem executar código/artefatos de PR. Nenhum secret ou variável foi configurado.
A composição é candidata; workflow_run depende da instalação na branch padrão,
ainda não autorizada. Sem dry-run hospedado, recibo ou escrita automática real.

Testes desta composição (não transferidos do #111): 70 suítes Node PASS; 26 casos
cobrem repetição/idempotência, CAS/conflito/resposta perdida, SHA/CI/origem/branches,
falha de consulta/evidência insuficiente, documentação/loops e locks. Mais 8 casos
documentais e 22 de política Vercel. Lint e TypeScript PASS. YAML validado e CI
comparada estruturalmente à base: só histórico completo no checkout de validar,
gate HANDOFF e suíte nova; Gate 1/permissões/jobs restantes intactos. Build padrão Turbopack PASS em 31,73 s
com placeholders públicos inertes, sem .env/credenciais reais. Diff --check e
revisão de segurança PASS. Revisão independente da composição sem achado crítico
ou importante para o Draft; observação de contrato CLAUDE corrigida e teste do
checkout confiável/cache/artefatos reforçado, 26 casos reexecutados PASS. Nenhum
resultado de teste hospedado/CI/Preview do candidato é presumido antes de sua
consulta no SHA publicado. Consultar checks próprios sem commit recursivo só
para registrar status.

Históricos seguintes mantêm seus SHAs/resultados e não representam autorização
vigente. AUTO-06 FAIL, AUTO-07 PASS e AUTO-08 TRANS-MAIN PASS seguem independentes.

### AUTO-10 interrompido e preservação local

AUTO-10 parou antes do merge por falta de confirmação da Fase 3. Na retomada
AUTO-10B, o proprietário confirmou disponibilidade, acesso administrativo funcional
e ciência do incidente. Proprietário decide/autoriza eventual recuperação;
executor monitora e interrompe a progressão em caso de falha. Nenhuma nova pergunta
de confirmação foi feita; não houve sinal de indisponibilidade durante a operação.

Os três documentos locais de AUTO-10 não foram sobrescritos: permaneceram no
worktree original e foram preservados byte a byte, com manifest/patch local em
/private/tmp/bs-checkpoint-auto-10b/preserved-local-docs. O novo worktree foi criado
da main integrada. Seu histórico relevante foi incorporado aqui; não depende do
acesso a esses artefatos para conhecer o resultado. #111 não sobrescreveu a main.

### Integração e baseline

- Autorizado: HEAD `53dce23e4973b1f1474fe165c415a307335929a0`, base `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`. Diff remoto de oito arquivos/blobs
  reconferido; 212 deployments completos/3 páginas, 43 Production, nenhum ativo.
- Ready confirmado em 2026-11-09T02:17:27Z; checks mantidos SUCCESS,
  zero threads/reviews bloqueantes. CodeRabbit pulou revisão automática por política
  do serviço para este OSS; não foi aprovação de código. Revisão local anterior e
  autorização nominal do mesmo HEAD preservadas; sem bypass --admin/auto-merge.
- Squash #113 em 2026-11-09T02:22:12Z: `2561b919da5ab31e0ed1882864ee069b9961b6f7`, pai `38b43490a8e0913c62a4ee6047ef48a8288ca0dc`, árvore
  `265ea1b74a1d567f6be81e1cb0d2b7991f2031cd` idêntica ao candidato autorizado. Sem funcionalidade da release.
- main:false exclusivo e framework nextjs conferidos na main, com validador,
  testes, CI e documentação autorizados. [CI do SHA integrado](https://github.com/therunnas/bslogistica/actions/runs/42550552142):
  validar/sql-local SUCCESS. Nenhuma migration/SQL ou alteração Supabase.

### Janela Production e controle Preview

| Evidência | Antes | Depois da janela |
| --- | --- | --- |
| Horário UTC | 2026-11-09T02:22:16Z | 2026-11-09T02:52:26Z |
| Production servido | dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4 | dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4 |
| SHA servido | 38b43490a8e0913c62a4ee6047ef48a8288ca0dc | 38b43490a8e0913c62a4ee6047ef48a8288ca0dc |
| IDs Production | 43 | 43, mesmo conjunto; zero novo/removido |
| Total deployments | 212 | 213; único novo é o Preview de controle |
| Deployment do merge | nenhum | nenhum target/estado; nenhum objeto GitHub de deployment do SHA |

Janela real de **1810.0 segundos**, 49 amostras,
histórico completo repaginado em cada leitura, queries bem-sucedidas. Nenhum novo
Production/staged Production, failed/cancelled indevido ou incidente observado.
Mantidos Git, Production Branch main, configuração, domínios, proteção e aliases
Production: admin.bslogisticas.com.br, bs-logistica-sistema-bslogisticas.vercel.app,
bs-logistica-sistema-git-main-bslogisticas.vercel.app e
bs-logistica-sistema-gold.vercel.app. Nenhum alias/domínio modificado manualmente.

Controle na branch `docs/checkpoint-auto-10b-gate1-result`, criada de `2561b919da5ab31e0ed1882864ee069b9961b6f7`:
commit `0732b66e85b3768101da854307ba6a5a32a6d25c` alterou só HANDOFF. Push sem PR em
2026-11-09T02:26:02Z não produziu status/deployment nas leituras
anteriores ao Draft. Após abrir #114 em 2026-11-09T02:30:26Z, Vercel gerou
`dpl_FbRVLLpDoBw7c2zzeCa5Ki5foZYS`, [Preview](https://bs-logistica-sistema-3ptokhj9b-bslogisticas.vercel.app), READY/source Git,
target Preview (null), SHA/ref corretos e gitSource.prId=114.
GitHub deployment `7645579824` success. STAGED como
subestado de Preview não é staged Production. Branch/commit/deployment preservados.

O caminho automático via PR foi comprovado. Não afirmar que push isolado sem PR
foi comprovado nem inferir sua causa. Não houve deploy manual, mudança Vercel,
bypass, autenticação funcional ou homologação a partir de READY/HTTP 200.
O fechamento documental posterior pode gerar outro Preview autorizado; ele tem
SHA/checks próprios e não pertence à contagem da janela acima.

### Histórico AUTO-10B — proposta do Gate 2 então não preparada

Reutilizado o [plano existente do #111](https://github.com/therunnas/bslogistica/blob/7e08270011f74ea5dfe4470097f58659eea81140/docs/continuidade/CHECKPOINT_AUTOMATICO.md),
sem repetir auditorias. Fonte atual `7e08270011f74ea5dfe4470097f58659eea81140`; base futura deve ser redescoberta
após a decisão sobre este checkpoint, não fixada permanentemente em `2561b919da5ab31e0ed1882864ee069b9961b6f7`.

| Caminhos | Preparação futura |
| --- | --- |
| .github/workflows/checkpoint-preview.yml; checkpoint-preview-signal.yml | Adicionar definições mínimas, sem executar candidato/artefato não confiável |
| scripts/atualizar-checkpoint-preview.mjs; checkpoint-preview.mjs; checkpoint-github-api.mjs; testar-checkpoint-preview.mjs | Adicionar três módulos Node nativos/locais e suíte; sem pacote ou segredo novo |
| scripts/validar-workflow-documental.mjs; testar-workflow-documental.mjs | Atualizar contrato compartilhado; checkpoint coerente com main, não com a release |
| package.json; .github/workflows/ci.yml | Somente novo teste/gate de HANDOFF e dependência de histórico necessária; preservar step Gate 1, jobs, Node 24 e permissões existentes |
| AGENTS.md; CLAUDE.md; docs/WORKFLOW.md e guia/checkpoint | Patches mínimos do contrato documental; sem copiar HANDOFF/release/#112 por arrasto |

Manter obrigatoriamente **false &&, contents: read, --dry-run e flag desligada**.
CHECKPOINT_AUTO_ENABLED: absent; disabled by default. Nenhuma variável ou segredo foi alterado.
workflow_run depende da definição na branch padrão; não contornar com escritor
em PR, PAT ou execução de código do candidato. Sem token Vercel/bypass/Supabase.
Validar composição isolada com testes próprios, idempotência, CAS/expectedHeadOid,
reprocessamento, dados incompletos, falha segura, loops e logs sem segredo. Não
emprestar os testes do #111 como prova de uma composição ainda não criada.

AUTO-11 autoriza criar/publicar PR Draft mínimo do Gate 2 da main então atual,
somente após consolidar #114 e verificar main/CI/Production. A integração do Gate 2
exige aprovação nominal separada. Instalação na main não realizada; gates 3 (dry-run), 4 (escrita) e 5 (recibo)
continuam sujeitos a autorizações independentes. Rollback sempre preserva
main:false; qualquer intervenção administrativa continua sem autorização.

### Histórico AUTO-10B — estado publicado e limites

#113 mergeado; #111 `7e08270011f74ea5dfe4470097f58659eea81140` e #112 `2d1c0cde7bd47154a281171d77858b530d0b6de2` permanecem
abertos Draft, sem integração ou reconciliação funcional. Controlador ausente na
main e desativado no #111. AUTO-06 FAIL/AUTO-07 PASS/AUTO-08 PASS mantêm escopos
históricos independentes. Nenhuma Production homologada por esta tarefa.

Artefatos sanitizados locais em /private/tmp/bs-checkpoint-auto-10b; evidências
essenciais constam aqui. O resultado foi registrado no #114; consultar no GitHub
o HEAD/SHA de integração e seus checks próprios, sem
transferir CI da main/smoke nem criar commits recursivos só para registrar checks.

### Histórico da main anterior ao AUTO-10B

Registros seguintes preservados da main integrada, com datas e limites originais.
Não são autorização atual nem nova auditoria financeira/Production.

### Gate 1 — baseline e candidato (08/11/2026 BRT; horários UTC)

- Retomada #111 em 7e08270011f74ea5dfe4470097f58659eea81140 e #112 em
  2d1c0cde7bd47154a281171d77858b530d0b6de2, ambos abertos Draft e preservados.
  Branch nova nasceu da main 38b4349, sem cherry-pick ou incorporação dos PRs.
- API Vercel em 2026-11-09T00:22:34Z: projeto bs-logistica-sistema,
  prj_K1OJ6G7AWnx6dQB1BDsy3HTELnCV, Git therunnas/bslogistica, Production Branch
  main; sem hooks nem overrides build/install/output/root/ignored-step retornados.
  Autoassign true e Standard Protection all_except_custom_domains preservados.
  Nenhuma configuração administrativa alterada; sem divergência material AUTO-08.
- Production servido: dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4, SHA
  38b43490a8e0913c62a4ee6047ef48a8288ca0dc. Aliases: admin.bslogisticas.com.br,
  bs-logistica-sistema-bslogisticas.vercel.app,
  bs-logistica-sistema-git-main-bslogisticas.vercel.app e
  bs-logistica-sistema-gold.vercel.app. Sem promoção/cancelamento ou alteração.
- Lista completa pré-publicação: 43 deployments Production (paginação completa,
  sem filtro de estado), registrados para comparação após o push. CI da main
  base: validar/sql-local success; permissão global de workflows read.
- vercel.json da main tinha somente $schema e framework nextjs; candidato
  preserva ambos e acrescenta git.deploymentEnabled exatamente {"main":false}.
  Nenhum booleano global, glob ou regra de outra branch; Previews habilitados por
  padrão. A regra ainda não está na main; o merge real segue acoplado a deploy
  enquanto a contenção não for integrada e comprovada.
- Validador/testes novos usam Node nativo, sem instalação de pacote. Executam
  contra JSON/arquivos reais temporários e códigos de saída, incluindo ausência,
  main:true, booleanos globais, globs, branch incorreta, inválidos, framework
  removido e duplicidade de chaves. CI acrescenta apenas um step após Setup Node,
  com check:vercel-deployments e test:vercel-deployments, sem mudar permissões.
- Testes escritos e observados falhando antes da implementação; 22/22 passaram
  depois. YAML comparado estruturalmente à main: removido o step novo, igualdade
  total de jobs/triggers/permissões/steps. Comandos do step executados com sucesso.
- 69/69 suítes Node e lint PASS. Primeiro tsc falhou em tipos .next de uma rota
  exclusiva do #111; origem comprovada no cache gerado. .next e tsbuildinfo
  anteriores preservados fora do checkout, tsc limpo PASS sem mudar app/tsconfig.
  Build padrão npm run build PASS (Turbopack, 136,42 s), com variáveis públicas
  inertes como na CI; nenhum teste/limitação antiga foi transferido a este SHA.
- Artefatos locais sanitizados/cache preservado em /private/tmp/bs-checkpoint-auto-09;
  não são checkpoint alternativo, não serão publicados nem são necessários à
  retomada. Resultados públicos finais serão registrados abaixo após criar o PR.

### Publicação do Draft e fechamento do checkpoint

PR [#113](https://github.com/therunnas/bslogistica/pull/113), aberto Draft contra
main, branch chore/gate1-production-deployment-guard. Código publicado em
`75fe207b77c936123af96000471f698ec8c23ecc`; diff remoto completo conferido: 8 caminhos e blobs idênticos
ao conjunto local revisado, sem src/SQL/migrations/auth/lockfile/controlador.

Conferência de `2026-11-09T00:36:26Z`: [CI validar e sql-local PASS](https://github.com/therunnas/bslogistica/actions/runs/42540864694),
Vercel success. Preview `dpl_52k9hWtcAtaKdsMtjujbZ6zZQFnp`, [URL](https://bs-logistica-sistema-6avmet2mx-bslogisticas.vercel.app),
source Git/branch/SHA corretos, target Preview/READY; recibo GitHub
`7644201426` success. CodeRabbit não revisou por ser Draft;
a revisão local independente não encontrou defeitos críticos/importantes.

Production preservada: mesmos 43 IDs, incluindo qualquer estado retornado;
zero novos Production, mesmo deployment servido/aliases/proteção/configuração
e mesmos HEADs de main/#111/#112. Nenhum comando de deploy ou alteração Vercel.

Este fechamento documental atende à etapa de registrar o resultado após criar o
PR; não muda código validado. Seu próprio SHA/checks/Preview devem ser consultados
no HEAD final do #113 e na entrega, sem emprestar PASS de 75fe207 nem fazer uma
série recursiva de commits só para registrar checks. SHA nominal de aprovação
será o HEAD final indicado na descrição do PR; qualquer alteração exige reaprovação.
Na AUTO-09, Gate 1 estava somente preparado; essa condição foi resolvida pelo squash e observação AUTO-10B registrados acima.

### Histórico AUTO-09 — proposta então futura, #113 integrado no AUTO-10B

1. Aprovar nominalmente o SHA final exato do Draft (HEAD da API, informado na
   descrição/entrega final); qualquer commit novo invalida a aprovação anterior.
   Reconfirmar a main e baseline servida acima; se divergirem, STOP/revisão.
2. Diff esperado: 8 arquivos — vercel.json, dois scripts Node, package.json,
   .github/workflows/ci.yml e HANDOFF/PROGRESS/ESTADO_DO_PROJETO. Zero src, SQL,
   migrations, lockfile, auth, documentos #112 ou controlador; sem release #111.
3. Checks obrigatórios para a decisão: validar/sql-local e Vercel no mesmo HEAD,
   22 casos da regra e validação documental/Node/lint/tsc/build aprovados. Nenhuma
   review bloqueante ou conflito pendente; CI verde não é homologação.
4. Janela proposta: 30 minutos após autorização, com responsável disponível e
   sem alterações concorrentes main/Vercel. Horário nominal e responsável devem
   ser confirmados pelo proprietário antes de integrar; não estão autorizados.
5. Método proposto: squash, após tornar Ready somente se autorizado, com
   --match-head-commit no SHA aprovado, sem --admin ou auto-merge. Reconsultar
   checks, reviews, threads e base imediatamente antes. Registrar o novo SHA do
   squash; ele difere do candidato e precisa de evidência própria.
6. Antes/depois: capturar lista paginada de deployments Vercel sem filtro de
   estado, targets e aliases, e eventos/statuses GitHub. Observar por pelo menos
   3 minutos após o push/CI e reconferir após o controle Preview, cobrindo atrasos.
   Exigir zero novos Production/staged/failed/cancelled associados à integração,
   mesmo Production servido/aliases/proteção/Git. Não usar somente saída da CLI.
7. Autorizar separadamente um evento sintético em branch Preview aprovada, sem
   regra de negócio, secrets ou banco. Exigir source Git, SHA/branch corretos,
   target Preview READY, main:false preservado e zero Production inesperados.
   O Preview deste Draft demonstra a branch atual; não substitui o controle
   posterior ao merge. Sem evento autorizado/evidência suficiente, BLOQUEADO.
8. Resposta a falha: FAIL/STOP e suspender progressão. O proprietário deve nomear
   antes quem poderá executar contenção administrativa e sob qual autorização.
   Nenhuma mudança de Production, alias, promoção ou cancelamento está permitida
   nesta etapa. Não reverter vercel.json retirando main:false: isso reabilitaria
   deployments. Qualquer correção/rollback deve preservar a trava e o histórico.
9. Só depois da prova real do Gate 1: Gate 2 controlador mínimo instalado mas
   desativado → Gate 3 dry-run hospedado em leitura → Gate 4 escrita autorizada →
   Gate 5 primeiro recibo automático. Cada gate requer autorização independente.

### Histórico da main anterior ao Gate 1 — não é validação desta tarefa

Os registros seguintes foram preservados da main base; datas, PRs e estado do
banco refletem suas sessões originais. Não foram reauditados ou atualizados por
inferência a partir da release #111.

- Sessão 11: PR #100 marcado Ready e mergeado por squash com `--match-head-commit`
  no HEAD autorizado `a391079671539ddd89b8e2cd910adb65d68c9a74`, depois de reconfirmar
  CI, Preview, `CLEAN` e ausência de revisões bloqueantes. `main` =
  `91513b91b11461ac48d8dfe6af118234bfb6fbc0`; CI de `main` (run `42077946742`)
  verde; deploy automático de Production `7581007010` em `success`.
- Sessão 12, Production: sem acesso à Vercel (sem CLI, token ou MCP), então nenhum
  rollback foi tentado. Não há candidato comprovadamente melhor: o último deploy
  anterior a qualquer migration 035+ é o de `3f5125c` (30/10, deployment
  `7441801844`), que descartaria os PRs FIN-PR-01 a 13 sem prova adicional; a `main`
  tem suíte de compatibilidade 034 → 045 (697 asserções) e Production já recebeu vários
  deploys nesse estado. Smoke não destrutivo: `/login` e `/esqueci-senha` 200;
  `/dashboard`, `/fechamento`, `/containers`, `/operacional`, `/faturamento` e `/mfa`
  redirecionam para `/login`; `POST /api/fechamento/xlsx-cliente` sem sessão responde 405.
  `max(version)` em Production = `20261101120000` (034), lido em transação `READ ONLY`.
- Sessão 12, HML: head `20261112120000` (045), 50 migrations, confirmado por leitura.
  Dump de dados de `public` antes das escritas. Contas e dados sintéticos
  `E2E-S11` (lista de IDs em
  [Homologação integrada](financeiro/homologacao-fin-pr-13.md)). Resolução
  comercial permaneceu **OFF**; o motor por vigência já estava ligado.
- Execução: app Next local (porta 3100) ligado só ao HML, JWT reais, TOTP real.
  Resultados por caso e achados na matriz. Nenhum defeito financeiro encontrado;
  um achado de documentação (regra de arredondamento da HE) e quatro observações.
- Sessão 13: resolução comercial ligada em HML só durante B02, C03 e C04 e restaurada
  para OFF (verificado). Navegador real (Chrome): C05, D04, D05, D09 e fluxos de
  recuperação. Microsoft Excel real (AppleScript): E03 e E04, com filtros aplicados.
  A05: papel e auditoria pela interface; recuperação sem MFA e com um TOTP. Regra da HE
  (15 → 30, 45 → 60) aprovada e corrigida em `ARQUITETURA.md`. Resultado 25/1/1/0.
- Sem Preview da Vercel apontado para HML (sem acesso à Vercel). Dynamis continua
  indisponível: E06 BLOQUEADO, sem inferência.

- Sessão 14: PR #101 mergeado por squash em `e7f77b0` (CI verde no HEAD `1371f07`; só
  documentação). A05 fechado em stack local isolada com captura de e-mail; E06 executado com
  a planilha Dynamis (SHA-256 `2b211d4c…18f7`, comparação por componente, sem paridade);
  achado G explicado sem alterar código; H corrigido no PR #102 (rótulos "fim exclusivo");
  novo achado I (margem do Dashboard sem custo de Containers) e dependência J (modelo de e-mail
  do convite). Manual de uso e plano 034 → 045 redigidos.

- Sessão 15: PR #102 mergeado (`b63d33b`). Achado I corrigido no PR #104 (custo de Containers
  na margem do Dashboard e dos Relatórios; 67/67 suítes, lint e tsc). Manual corrigido
  (Presente/Falta/Substituição; Faturamento; Relatórios) e runbook corrigido (os scripts
  `comparar-catalogo-*.sh` só operam no local). Config de Auth de HML e Production lida por
  `supabase config pull --dry-run` (nada gravado). **Backup novo de Production** em
  `~/bs-backups-producao/2026-11-05-034/` (cifrado, senha no Chaveiro) com restauração local
  comprovada; Production não tem dados de negócio.

- Sessão 16: #104 corrigido para o schema 034 (defeito medido no PostgREST real sobre o backup) e
  mergeado (`071ea6d`); margem total no Fechamento e no Faturamento no PR #105; backup verificado e
  restaurado (Auth funcional); ensaio integral 034 → 045 e reversão; checklists de e-mail e backup.
  Parecer: NO-GO condicional (runbook, seção 11).

## Migrations por ambiente

**09/11/2026 (vigente):** main até 050; HML 050 (046–050 aplicadas uma a uma, verificadas); Production 034. Registros abaixo são históricos.

FUNC-02: nenhuma migration aplicada nesta sessão. Main até 045, #111 candidatas
046–049, #118 com 050. Registros HML045/Production034 abaixo são históricos, não
catálogo reconferido. Antes de HML, cumprir o roteiro OFF/catálogo/backup na matriz.

FUNC-01 documental: nenhuma consulta/operação de banco ou alteração SQL. Os estados abaixo
são o último registro herdado da main, não reconferidos nesta tarefa.

- Esta etapa não criou nem aplicou migration.
- HML `qbnfcmrxmssnwkhaitgd`: 045; escritas apenas de dados sintéticos pelas RPCs e
  tabelas da própria aplicação, e uma transação com `ROLLBACK` (último admin).
- Production `ehkduqokntemtmqzdrbd`: 034; apenas leitura do head. Sem backup recente
  (último lógico: 23/10/2026).

## Autorizações históricas — não transferem autorização

FUNC-03 vigente: publicar os cinco ajustes documentais no #117 com commit/push normal; preparar/testar/publicar composição técnica em branch/PR Draft próprios. Sem merge ou migration remota.

**Histórico FUNC-02:** análise e preparação documental local naquela sessão. Nenhuma
autorização nova de commit/push, merge ou aplicação HML. A próxima publicação deve
ser autorizada para o diff documental revisto; depois cada integração/ambiente
exige seu escopo nominal. Autorizações anteriores abaixo são históricas.

Histórico da autorização FUNC-01: publicação dos cinco documentos em branch documental própria,
testes, commit/push normal e PR Draft contra main. A correção funcional do item7
foi autorizada em branch/PR separados e está sob preparação, sem reutilizar o
HANDOFF obsoleto do #111/#112. Nenhum merge foi autorizado nesta etapa.
Gates 3–5 da automação PAUSADOS; HML/Supabase, migrations remotas, Production,
credenciais e flags exigem autorização própria. O squash #116 é histórico concluído.

Histórico AUTO-09: implementação mínima, testes, commit/push normal somente na
branch chore/gate1-production-deployment-guard e criação de PR Draft contra main.
Merge e mudanças de main/Production não autorizados. Os itens abaixo são históricos.

- sessão 11: ready e squash merge do PR #100 condicionados ao HEAD exato;
- sessão 12: proteger Production (rollback só com candidato comprovado), preparar HML
  com identidades e dados sintéticos, executar a matriz de 27 casos e atualizar a
  documentação. Nenhuma foi usada para alterar Production.

## Proibições históricas — prevalece o escopo atual acima

FUNC-03 vigente: sem merge, SQL remoto, Production, dados reais, ON comercial, controlador, Gates 3–5, novas infraestruturas ou alteração do #118 original.

**Histórico FUNC-02:** sem merge, migrations/SQL remotos, flag comercial ON, Production,
controlador ou Gates 3–5, nova infraestrutura, dados reais, commit/push não
autorizados. Não atualizar #111/#112/#118 remotamente por inferência.

Sem iniciar Gates 3–5, remover false &&, habilitar flag/contents: write/--write,
recibos automáticos ou alteração de workflow. Sem merge documental/funcional,
merge/atualização #111/#112, Supabase/HML/Production, migration remota, limpeza de
dados, credenciais, aliases/domínios, deploy manual, force push, novos projetos ou
site institucional. A branch documental só publica os cinco arquivos autorizados;
app/SQL/migration nova locais do item7 pertencem ao PR funcional separado.
Preservar main:false e todos os históricos/worktrees.

Os limites AUTO-09 abaixo pertencem àquela sessão, não desfazem o squash concluído.

AUTO-09: sem merge, main direta, release #111/#112, Vercel real, HML/Supabase,
migrations, credenciais, dados, domínios/aliases, deploy manual, bot ou gates 2–5.

- sem migration em Production, dados de Production ou alteração de variáveis de Production;
- sem ligar a resolução comercial em HML sem autorização específica;
- sem e-mails reais, pagamentos externos, dados pessoais reais ou alteração de usuários reais;
- sem inferir regra comercial nem usar R$ 35.118,12 como fixture de outra base.

## Bloqueios e riscos

**09/11/2026 (vigente):** interface dos 9 cenários PASS em app local ligado ao HML (Preview segue sem vínculo comprovado); Production 034 com frontend posterior (telas de schema novo indisponíveis até 034 → 050); backup `pg_dump` de Production pendente. Registros abaixo são históricos.

**FUNC-02:** três conflitos documentais entre #117/#118; prefixo 046–049 e
consumidores 047/049 ainda precisam de composição/CI. Main/#118 usam RPC antiga
revogada pela 047. Aplicação HML bloqueada até catálogo/backup/janela e autorização;
048 OFF não aprova fallback ON. Riscos anteriores abaixo conservam seus escopos.

- Gate 1 PASS é delimitado a esta janela/amostragem e ao Preview automático via PR;
  não é garantia infinita ou bloqueio universal de deploy manual/promoção.
- Gate 2 instalado desativado pelo AUTO-12; execução do Gate 3 e escrita dos Gates 4–5 dependem de novas autorizações. O bot não está ativo.
- Originais locais AUTO-10 foram preservados; não confundi-los com o checkpoint
  registrado no #114 ou substituir o estado da main pela release #111.
- Parágrafos funcionais seguintes são históricos, sem reconciliação nesta tarefa.

- Histórico AUTO-09: trava integrada no AUTO-10B; Gate 2 preparado no AUTO-11 e instalado desativado no AUTO-12. Nenhuma autorização se estende ao Gate 3.
- GitHub informa main sem proteção; o check falha diante de regressão, mas não
  impede por si só um merge administrativo. Nenhuma proteção/ruleset/permissão
  foi modificada. Exigir checks e revisão na decisão nominal.
- Git.deploymentEnabled governa eventos Git; não bloqueia universalmente deploy
  manual/promoção. Diferenças sandbox/Next.js e observação delimitada continuam
  limites. Não declarar Production homologada ou controlador ativo.
- Registros funcionais/banco seguintes são históricos da main; sem reconciliação
  funcional nesta tarefa nem autorização herdada desses parágrafos.

- **Histórico funcional: Production roda código 045 sobre banco 034.** Não é nova
  inspeção de banco. O acoplamento Git/Production referido nos registros antigos
  foi contido pelo Gate 1; esta etapa não altera código ou banco servido. Opções
  históricas de tratamento, sempre com autorização própria: manter
  (a compatibilidade 034 → 045 está testada), conter por rollback na Vercel com
  acesso administrativo, ou preparar 035–045 em Production com backup novo.
- Pendências reais: revisão humana dos PRs #103 e #104; **segunda cópia** do backup em outro
  local protegido; conferir no Dashboard do Supabase os **modelos de e-mail** de convite e
  recuperação, a **expiração** do link e a autenticação do domínio de envio (ver runbook, 1.2);
  decisão e autorização para implantar 035–045 em Production, com dump novo se houver escrita.
- Dados sintéticos em HML, com faturas emitidas (imutáveis), exigem tarefa própria de
  limpeza. Regra de arredondamento da HE aprovada e documentada na sessão 13.
- Manual de utilização e preparação de Production 035–045 são gates posteriores.

## Retomada histórica — não usar como tarefa ativa

1. Descobrir worktrees/branches/HEADs e preservar alterações de terceiros.
2. Conferir o novo HEAD do #117, seis documentos, CI e Preview próprios, mantendo Draft.
3. Localizar a branch técnica FUNC-03 criada da main atual; seu HANDOFF governa a composição.
4. Executar somente o restante da composição/testes locais 046–050 e publicar Draft técnico.
5. HML requer identidade/catálogo/backup/restauração/janela/Preview compatível/OFF e autorização separada. Sem merge ou ativação nesta tarefa.

### Retomada FUNC-02 — histórica


1. Descobrir worktrees, refs remotas e status; preservar os cinco ajustes locais
   FUNC-02 e os três originais AUTO-10. Esta branch ainda é #117 no SHA publicado
   73a3f35b2dca871e92b2623e84790c3b36308330, sem commit dos ajustes.
2. Ler a consolidação FUNC-02 na matriz e conferir main/#111/#112/#117/#118.
   Se os HEADs mudaram, reavaliar somente o delta pertinente.
3. Revisar/publicar documentos só após autorização: NEGOCIO.md idêntico ao #112,
   item 7 implementado no #118 e plano 046–050, sem checkpoints históricos ativos.
4. Preparar prefixo técnico com consumidores compatíveis e composição/CI próprias
   somente no próximo escopo autorizado. Resolver os três documentos e quatro
   inventários do #118 conforme a base resultante; não fazer merge por inferência.
5. HML: solicitar autorização própria para catálogo/backup/restauração/janela e
   aplicação/testes OFF, sem ativação comercial. C1–C6 e Gates 3–5 permanecem pausados
   ou pendentes conforme o plano; Production não faz parte desta consolidação.

### Retomada FUNC-01 — histórica, substituída pelos passos acima

1. Descobrir worktrees/status/HEADs; preservar os originais dos cinco documentos
   e os três originais AUTO-10 no outro worktree. Nenhum reset/rebase/descarte.
2. Ler o HANDOFF da branch/PR da tarefa e conferir HEAD/checks/Preview próprios.
   A publicação documental não altera main nem transforma Preview em homologação.
3. Reconfirmar main/#111/#112 e consultar matriz17 itens, decisõesC1–C6 e lotes.
4. Prosseguir com FUNC-01 item7 na branch/PR funcional separado, sem copiar o
   checkpoint obsoleto do #111/#112 ou ampliar os lotes comerciais.
5. Preços/contratos e homologação são gates financeiros independentes. Não aplicar
   migration remota, publicar Production ou retomar Gates 3–5 por inferência.
