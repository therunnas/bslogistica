# Composição técnica 046–050 — FUNC-03

SDLC: Desenvolvimento / Testes / preparação de homologação. Candidato isolado da
main 75c47cd9a30e4888b197ca6ae27aa236c71ec589, sem merge de #111/#112/#117/#118.
Entrada operacional única: [HANDOFF](../HANDOFF.md). Este documento registra
manifesto, prova local e roteiro futuro; não autoriza SQL remoto ou ativação.

## Fontes e recorte

- #111: 7e08270011f74ea5dfe4470097f58659eea81140 — portabilidade seletiva de
  046–049, consumidores e testes. O PR tem 121 arquivos contra sua base histórica;
  não foi integrado integralmente. Excluídos cadastros/UX geral, dashboard/CSV,
  alteração de MFA, site institucional e infraestrutura do checkpoint.
- #118: fc51b54c978ac3042f96fb763cb21ab379231490 — normalizador/CHECK 050, domínio,
  limites inclusivos do formulário e testes. #118 original não foi alterado.
- #117 documental: 6f1d960ef78254cc6b2b9cc1639c5abe202ef54d — seis documentos,
  [CI aprovada](https://github.com/therunnas/bslogistica/actions/runs/42628879267),
  [Preview bem-sucedido](https://bs-logistica-sistema-bb0dn0ru3-bslogisticas.vercel.app).
  [Negócio e matriz](https://github.com/therunnas/bslogistica/blob/6f1d960ef78254cc6b2b9cc1639c5abe202ef54d/docs/NEGOCIO_X_SISTEMA.md)
  permanecem no PR documental; não copiar seus checkpoints para esta composição.

## Interfaces e regras preservadas

1. 046: faturas com lastro de apontamento OU adicional/serviço são imutáveis;
   guardas internas e revogação de escrita direta de papéis da API preservadas.
2. 047: registro de adicionais usa RPC idempotente; chave acompanha a intenção,
   consulta/reconciliação antes de retry e exclusão entre abas. Só marcador opaco
   persiste; payload/valores ficam na memória. Fallback legado apenas por PGRST202;
   erro de rede, autorização ou conflito não vira chamada sem chave. Não há token
   de auth em storage. Papéis/MFA continuam verificados no banco.
3. 048: código de precedência/estado e prévia compatíveis, sem executar ativação.
   Capacidade instalada não é resolução ligada. O caminho OFF retorna o cálculo
   anterior; C1 e ativação comercial continuam pendentes.
4. 049: adaptação de backend/dados/ações/formulário/rota; correção cancela e registra
   substituto na mesma transação, com trilha e trava por cliente. Disponibilidade
   é conferida pelo banco; faturado não admite nova correção/cancelamento.
5. 050: solicitação <= execução em CHECK, normalizador, TypeScript e formulário;
   anterior/mesmo dia válidos, posterior/datas civis inválidas recusados. Valores,
   participantes, competência e fatura não são recalculados pela alteração.

**Ajuste próprio de integração:** no servidor candidato 049, a recuperação genérica
por chave/payload podia devolver um serviço sem comprovar vínculo corrected com o
original indicado. Teste RED reproduziu o falso sucesso. A ação de correção agora
manda a mesma intenção à RPC 049, que confere esse vínculo e faz replay idempotente.
Três testes adicionais cobrem conflito de original, mesmo dia/reenvio/centavos,
recusa de faturado, sessão e datas inválidas.
A revisão independente encontrou também falso sucesso no formulário ao carregar
marcador anterior e bloqueio de recuperação após reload da correção. Cinco testes
novos do componente real reproduziram os casos: registro anterior tem mensagem
neutra e encerramento explícito antes de corrigir, marcador incerto não é descartado,
reconciliação exige vínculo ao original e o reload oferece o substituto auditado
sem nova escrita. Revisão final sem Critical/Important remanescentes. Nenhuma migration foi modificada
para esse ajuste; o registro comum mantém sua recuperação existente.

## Ordem e integridade das migrations

| Versão | Arquivo | Dependência |
| --- | --- | --- |
| 046 | 20261113120000_046_imutabilidade_fatura_com_adicionais.sql | 045 |
| 047 | 20261114120000_047_idempotencia_adicionais.sql | 046 e consumidor novo |
| 048 | 20261115120000_048_preco_base_como_recuo.sql | 047; instalar com resolução OFF |
| 049 | 20261116120000_049_correcao_servico_container.sql | 045/047; manter após 048 pelo anúncio de capacidades |
| 050 | 20261117120000_050_container_same_day_request.sql | 045; ordem final após 049 |

55 arquivos de migrations, sem duplicatas de timestamp; 045 e anteriores intactas.
046–049 são bytes idênticos ao #111; 050 idêntica ao #118. O preflight da 050 exige
CHECK original exato da 045 e falha em drift; nunca remover outro CHECK para passar.
SQL efetivamente aplicado localmente em ordem até 050, sem usar migration repair,
include-all, reordenação ou edição de versão histórica. No HML existente, catálogo
real divergente exige STOP antes de qualquer aplicação.

## Evidência desta composição

- Baseline main: 70/70 suítes Node PASS antes da portabilidade.
- RED: mesmo dia/domínio/formulário, interfaces ausentes e recuperação de correção
  sem vínculo ao original; falhas de inventário/CI leitores foram registradas.
- GREEN desta composição: 72/72 suítes Node PASS; backend 13 casos, tela 65 e domínio
  23. São resultados novos, não transferidos da FUNC-01. Testes de Gate 1 incluídos.
- SQL: 55 versões e 51 suítes PASS no projeto local exclusivo
  bs-fin11-local-func037709c23. SQL050 executou 049 PRESENTE, não o ramo alternativo
  sem correção. Datas inválidas, replay, autorizações/MFA, faturados e finanças
  cobertos pelas suítes reais. 048 testa ON/OFF apenas em fixtures transacionais
  sintéticas com ROLLBACK; isso não aprova regra comercial ou ativa ambiente remoto.
- Preservação: dois serviços criados na 045 (um livre, outro faturado), uma fatura,
  itens, participantes, adicionais, snapshots e auditoria iguais após CADA versão
  046–050; replay das chaves antigas sem escrita. Colunas 047 nulas no legado,
  normalizador owner/ACL/atributos e RLS/ACL de container preservados.
- Resolução persistida e efetiva falsas depois dos ensaios. Nenhum dado real usado,
  nenhum token/segredo incluído em logs versionados.
- Lint e TypeScript PASS; build final Turbopack PASS em 34,8 s com dependências próprias
  e placeholders públicos inertes; concorrência real: adicionais 128 asserções e
  faturas 41, seis rodadas por corrida, zero falhas. Validação documental final
  e revisão registradas no HANDOFF; CI/Preview próprios ainda pendem de publicação.
- Build inicial com node_modules simbólico foi recusado pelo Turbopack por sair da
  raiz do worktree. Dependências instaladas com npm ci no próprio worktree, lockfile
  intacto; primeira repetição PASS em 207 s e build final após ajuste UI PASS em 34,8 s. Sem mudar Next/Vercel.

Não foram executados E2E HML/navegador real, migrations remotas, dry-run remoto,
rollback SQL, nem a matriz histórica inteira de compatibilidade 034–047 via HTTP.
Runners existentes de compatibilidade e seus testes de isolamento foram portados;
seus cenários não são declarados executados por isso. CI/Preview do novo candidato
precisam de evidências próprias após publicação; Preview com HML045 não prova 050.

## HML existente — roteiro futuro, sem execução

1. **Autorizar nominalmente o gate OFF**, com HEAD final/diff/versões, responsável,
   janela e procedimento de incidente. Nenhum merge ou autorização desta FUNC-03
   concede aplicação remota. Previews automáticos preservados, sem promoção.
2. **Identidade e catálogo somente leitura no gate autorizado:** confirmar projeto
   qbnfcmrxmssnwkhaitgd (HML), jamais ehkduqokntemtmqzdrbd (Production), banco e
   API/Preview/branch/SHA correspondentes. HML045 é último registro documental,
   não nova leitura desta sessão. Inventariar todas as versões/definições/hashes,
   CHECKs/FKs/índices/NOT NULL, grants/owner/search_path/SECURITY DEFINER, RLS e
   triggers. Confirmar preflight 050 e privilégios do executor não-superusuário.
3. **OFF explícito:** pricing_settings.tarifas_por_funcao=false E
   resolucao_de_tarifas_ativa()=false. Fotografar estado do motor, flags, datas e
   auditoria antes/depois de cada versão. Se divergirem, STOP; não mudar flags por
   conta própria. Capacidade preco_base_recuo=true não comprova flag ON/OFF.
4. **Backup HML novo**, schema/dados/Auth conforme o runbook vigente, hash/segunda
   cópia protegidos fora do Git e restauração comprovada em destino isolado
   existente e autorizado. Não reutilizar backup antigo de Production como prova.
   Se faltar destino, autorização ou evidência, BLOQUEADO; não criar Supabase novo.
5. **Janela sem mutações concorrentes:** HML é compartilhado por Previews antigos.
   Definir candidato compatível e responsáveis; não usar clientes antigos após 047,
   pois a RPC antiga foi revogada. Preservar dados/faturas/histórico, sem reset ou
   limpeza. Aprovar limites de lock/tempo, especialmente o CHECK 050 e DDL do prefixo.
6. **Dry-run futuro** deve listar exatamente 046→047→048→049→050 partindo do catálogo
   045 reconferido e da composição inteira. Se diferir, STOP. Não usar #118 isolado,
   include-all, config push ou repair. Aplicação posterior exige autorização própria;
   conferir versão/catálogo/flags e dados após cada passo antes de prosseguir.
7. **Aceite 046/047:** lastro só adicional/serviço ou misto imutável; fatura=itens=
   receita; mesma chave/payload devolve mesmo ID sem linhas/trilhas extras, conflito
   recusa; timeout reconcilia antes de retry; cancelado/faturado mantém replay.
   Cobrir duas abas e corrida com fatura, sem resultado desconhecido virar nova intenção.
8. **Aceite 048 OFF:** paridade de receita/custo/snapshots de lançamentos anteriores,
   jornada normal/HE/saída antecipada/sábado/especial pelo comportamento OFF vigente.
   Não ativar fallback nem exigir preços de ON. Não rodar suítes de fixture local
   diretamente no HML: elas alteram flags em transações para testar outros estados.
9. **Aceite 049/050:** mesmo dia/anterior/bissexto passam; posterior/inválidas não
   gravam parcialmente; correção/replay e vínculo ao original auditados; faturado
   não altera; legado/reenvio/participantes/adicionais/centavos preservados. Admin,
   operacional/sem papel e MFA conforme login; financeiro não atravessa papel operacional.
10. **Aceite integrado e encerramento:** competência distinta da execução, fechamento
    misto, exportação cliente sem custo/margem e totais conciliados; snapshots/faturas
    anteriores idênticos. Registrar SHA/URL/schema/flags/ator sintético/data e
    PASS/FAIL/BLOQUEADO por caso. Manter OFF e preservar histórico. Somente depois
    decidir integração Git/uso piloto, cada qual com autorização nominal.

## Decisões comerciais e resposta a falhas

**A — instalar/testar 048 OFF** é separada de **B — aprovar/ativar fallback ON**.
C1–C6 continuam: recuo para preço-base versus bloquear, reajustes/vigência,
agrupamento de funções/preço, custo avulso por pessoa versus rateio, modalidades/
unidades praticadas e exceções de sábado/hora paga. Nenhuma foi decidida por código.

Falha de versão: STOP, registrar estado real e confirmar rollback da transação
corrente; versões anteriores podem ter COMMIT. Preferir correção progressiva.
Não remover main:false nem reverter 046 reabrindo faturas; não apagar chaves 047,
trilhas corrected 049 ou registros no mesmo dia para voltar a '<' na 050.
Os dois runbooks de rollback copiados do #111 são referência condicional histórica,
não procedimentos executados/aprovados nesta sessão. Reversão/restauração e qualquer
intervenção em Production exigem decisão própria; não apagar histórico de migrations.

## Integração futura e PRs preservados

Esta composição já inclui 046–050. Depois da homologação OFF e revisão dos HEADs,
propor integração documental #117 e, separadamente, integração deste PR técnico.
Resolver HANDOFF/PROGRESS/ESTADO entre eles combinando evidências atuais e históricos,
sem substituir o estado por checkpoints antigos. Não integrar #118 novamente por
suposição: seu patch 050 já está aqui, preservado por SHA para rastreabilidade.
#111 completo conserva UX/funcionalidades fora deste recorte, e #112 conserva o
histórico de negócio portado seletivamente para #117. Encerramento/reconciliação
futuros desses PRs dependem de autorização; nenhum foi fechado ou mergeado.

## Manifesto do candidato

Caminhos abaixo compõem o diff técnico contra a main base. Documentos gerais de
negócio ficam no #117; configuração de Production/controlador/auth não é portada.

### CI e comandos

- `.github/workflows/ci.yml`
- `package.json`

### Consumidores

- `src/app/(painel)/apontamentos/painel-apontamentos.tsx`
- `src/app/(painel)/containers/[id]/corrigir/page.tsx`
- `src/app/(painel)/containers/_acoes.ts`
- `src/app/(painel)/containers/correcao-container.tsx`
- `src/app/(painel)/containers/detalhe-container.tsx`
- `src/app/(painel)/containers/formulario-container.tsx`
- `src/integrations/supabase/types.ts`
- `src/lib/adicionais-dados.ts`
- `src/lib/adicionais-registro.ts`
- `src/lib/adicionais.ts`
- `src/lib/adicional-intencao.ts`
- `src/lib/container-servico-backend.ts`
- `src/lib/container-servico-dados.ts`
- `src/lib/container-servico-servidor.ts`
- `src/lib/container-servico.ts`
- `src/lib/preco-do-dia.ts`
- `src/lib/tarifas.ts`
- `src/lib/vigencias-dados.ts`

### Migrations

- `supabase/migrations/20261113120000_046_imutabilidade_fatura_com_adicionais.sql`
- `supabase/migrations/20261114120000_047_idempotencia_adicionais.sql`
- `supabase/migrations/20261115120000_048_preco_base_como_recuo.sql`
- `supabase/migrations/20261116120000_049_correcao_servico_container.sql`
- `supabase/migrations/20261117120000_050_container_same_day_request.sql`

### Testes e runners

- `scripts/_aguardar_postgrest.py`
- `scripts/test-calendario-runners.mjs`
- `scripts/test-container-backend.mjs`
- `scripts/test-container-telas.mjs`
- `scripts/testar-adicional-idempotencia.mjs`
- `scripts/testar-adicional-recuperacao.mjs`
- `scripts/testar-compatibilidade-deploy.mjs`
- `scripts/testar-compatibilidade-deploy.sh`
- `scripts/testar-concorrencia-adicional.sh`
- `scripts/testar-concorrencia-fatura.sh`
- `scripts/testar-configuracoes.mjs`
- `scripts/testar-container-servico.mjs`
- `scripts/testar-func-ready.mjs`
- `scripts/testar-interfaces-vigencia.mjs`
- `scripts/testar-motor-vigencia.mjs`
- `scripts/testar-nucleo-isolamento.mjs`
- `scripts/testar-periodo-contratual.mjs`
- `scripts/testar-regras-definitivas.mjs`
- `supabase/tests/002_autorizacao.sql`
- `supabase/tests/005_enforcement_aal2.sql`
- `supabase/tests/027_regras_financeiras_bs.sql`
- `supabase/tests/029_fechamento_conciliacao.sql`
- `supabase/tests/032_mfa_opcional.sql`
- `supabase/tests/034_mfa_somente_login.sql`
- `supabase/tests/035_nucleo_financeiro_puro.sql`
- `supabase/tests/038_periodo_contratual.sql`
- `supabase/tests/041_tarifas_por_funcao_e_periodo.sql`
- `supabase/tests/042_diaria_individual_e_bonus.sql`
- `supabase/tests/043_dias_especiais_v2.sql`
- `supabase/tests/045_container_servico.sql`
- `supabase/tests/046_imutabilidade_fatura_adicionais.sql`
- `supabase/tests/047_idempotencia_adicionais.sql`
- `supabase/tests/048_preco_base_como_recuo.sql`
- `supabase/tests/049_correcao_servico_container.sql`
- `supabase/tests/050_container_same_day_request.sql`

### Documentação

- `PROGRESS.md`
- `docs/ESTADO_DO_PROJETO.md`
- `docs/HANDOFF.md`
- `docs/financeiro/composition-046-050.md`
- `docs/runbooks/rollback-idempotencia-adicionais.sql`
- `docs/runbooks/rollback-imutabilidade-faturas.sql`
