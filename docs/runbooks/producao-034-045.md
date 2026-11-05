# Plano de implantação em Production — 034 → 045

SDLC: Deploy / Manutenção. **Este documento é um plano. Não autoriza a execução de nada**
em Production. Cada passo remoto exige autorização específica da pessoa responsável, na
janela combinada. O estado factual fica em [Estado do projeto](../ESTADO_DO_PROJETO.md); as
condições comuns, em [Runbooks](README.md).

## 1. Estado de partida (confirmado por leitura, 05/11/2026)

- Production `ehkduqokntemtmqzdrbd`: `max(version)` em `supabase_migrations.schema_migrations`
  = `20261101120000` (034), 39 registros. Nada foi aplicado ou alterado nas sessões 11 a 14.
- Código publicado: `main` (inclui FIN-PR-01 a FIN-PR-13) com deploy automático de Production
  ativo desde o merge. As rotas protegidas redirecionam para `/login` e `/api/fechamento` sem
  sessão responde 401. Nenhuma incompatibilidade foi observada sem login; as rotas
  autenticadas **não** foram exercitadas em Production.
- A compatibilidade código × schema 034 … 045 é comprovada **em cópia isolada** (suíte de
  compatibilidade, 697 asserções), não em Production.
- HML `qbnfcmrxmssnwkhaitgd` está na 045 e foi homologado (25 PASS, 1 PARCIAL, 1 BLOQUEADO).
- **Não há backup recente de Production**: `supabase backups list` vazio e PITR desligado; o
  último backup lógico é de 23/10/2026.
- Motor por vigência ligado em Production desde 29/10 e resolução por função/período
  **desligada** (último relato; reconferir por leitura antes da janela).

### 1.1 Inventário de Production lido em 05/11/2026 (somente leitura)

Banco de 14 MB, **sem dados de negócio**: 0 clientes, contratos, colaboradores, operações,
turnos, folhas, lançamentos, faturas e adicionais. Há 3 contas em `auth.users` (1 fator MFA),
10 perfis, 9 papéis, 33 registros de auditoria administrativa e 1 de auditoria financeira. Motor
por vigência ligado. Extensões: `btree_gist`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements`,
`supabase_vault`. Consequência: a verificação "valores iguais antes e depois" é trivial hoje
(somas = 0) e o risco financeiro da implantação é baixo; o risco real é de **catálogo, grants,
RLS e Auth**. Se alguém lançar dados antes da janela, a linha de base precisa ser refeita.

### 1.2 Configuração de Auth lida em 05/11/2026 (somente leitura, `config pull --dry-run`)

| Item                                             | HML `qbnfcmrxmssnwkhaitgd`                                         | Production `ehkduqokntemtmqzdrbd`                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Site URL                                         | `https://bs-logistica-sistema-git-staging-bslogisticas.vercel.app` | `https://admin.bslogisticas.com.br`                                          |
| URLs de redirecionamento adicionais              | nenhuma                                                            | nenhuma                                                                      |
| Cadastro público (`enable_signup`)               | desligado                                                          | desligado                                                                    |
| Confirmação de e-mail                            | ligada                                                             | ligada                                                                       |
| Intervalo mínimo entre e-mails / limite por hora | 1 min / 30                                                         | 1 min / 30                                                                   |
| SMTP                                             | Resend, `smtp.resend.com:465`, remetente de homologação            | Resend, `smtp.resend.com:587`, remetente `nao-responda@` do domínio de envio |
| MFA TOTP                                         | inscrição e verificação ligadas                                    | inscrição e verificação ligadas                                              |

**Não foi possível ler por este caminho** (dependem do administrador do Supabase, no Dashboard
em Authentication): o **conteúdo** dos modelos de e-mail de **convite** e de **recuperação**
(o link precisa apontar para `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
na recuperação; o convite precisa de um link que **não consuma o token no GET**, ver achado J);
o **tempo de expiração** do link (`mailer_otp_exp`); a **autenticação do domínio de envio**
(SPF/DKIM no provedor); e se o Site URL de HML (um Preview `git-staging`) é o ambiente que se quer
usar nos links de homologação. Nada foi enviado nem alterado.

## 2. Princípios

1. Aplicar **somente** migrations versionadas, **nunca** editar migration já aplicada.
2. As migrations 041 e 042 nascem **desligadas**; a resolução comercial **continua OFF**
   depois da implantação. Ligá-la é decisão separada (seção 9).
3. Nada de `supabase config push`, `TRUNCATE`, `DELETE` sem `WHERE` ou rollback por tentativa.
4. Sem janela de pico: preferir fora do expediente, com a pessoa responsável presente.
5. Qualquer critério de interrupção (seção 8) para a implantação e aciona a seção 7.

## 3. Pré-condições (todas antes da janela)

| #   | Item                                                                               | Evidência exigida                            |
| --- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Autorização escrita para a janela, o ambiente e as migrations 035–045              | mensagem da pessoa responsável               |
| 2   | Código na `main` estável e CI verde; PR documental e correções pendentes decididos | SHA e run de CI                              |
| 3   | **Backup novo e restaurável** de Production (seção 4)                              | arquivos, SHA-256 e relatório de restauração |
| 4   | Head de Production = 034, lido minutos antes (`READ ONLY`)                         | saída da consulta                            |
| 5   | Verificação de dependências e dados (seção 5) sem pendência                        | relatório                                    |
| 6   | Ensaio completo 034 → 045 em cópia isolada com o **dump novo** de Production       | resultado do ensaio                          |
| 7   | Controle do deploy automático da `main` (seção 6)                                  | configuração registrada                      |
| 8   | Contas de teste de Production autorizadas (admin e operacional) para o smoke       | autorização nominal                          |
| 9   | Plano de comunicação e responsável por cada decisão de interrupção                 | lista                                        |

## 4. Backup novo e restaurável

1. `supabase db dump --linked --project-ref ehkduqokntemtmqzdrbd` para **esquema** e para
   **dados** de `public` e, com cuidado de sigilo, de `auth` (usuários e MFA), em arquivos
   separados, **cifrados** e fora do Git. Usar `env -u SUPABASE_ACCESS_TOKEN` e conferir o
   `project-ref` (o `.env` define `SUPABASE_PROJECT_ID`).
2. Calcular o SHA-256 de cada arquivo e registrar tamanho e contagem de linhas por tabela.
3. **Restaurar** em banco local isolado (porta e `project_id` exclusivos) e comparar contagens,
   somas financeiras (`billed_amount`, `cost_amount`, totais de fatura) e o catálogo. Backup
   que não foi restaurado não conta.
4. Guardar o backup em local controlado pela BS; registrar quem o guarda.
5. Registrar a data/hora do dump: o que for gravado depois dela **se perde** numa restauração
   completa. Por isso a janela não deve ter escrita de usuários.

### 4.1 Backup realizado e restauração comprovada (05/11/2026)

Feito **sem alterar Production** (dump com snapshot consistente; só leitura). Local:
`~/bs-backups-producao/2026-11-05-034/` na máquina de quem executou, permissão 700, **fora do
Git**; arquivos cifrados (AES-256-CBC com PBKDF2) e senha guardada no Chaveiro do macOS (item
`bs-backup-producao-2026-11-05-034`). Conteúdo: esquema de `public`, dados de `public`, dados
de `auth`, histórico `supabase_migrations` e papéis do cluster. Os SHA-256 dos arquivos em claro
foram conferidos depois de decifrar (5/5), e o texto em claro foi apagado. **Falta uma segunda
cópia em outro local protegido**, decisão da pessoa responsável: um backup só no notebook não
é suficiente para a janela.

Restauração em Supabase **local isolado** (projeto e portas próprios), nesta ordem: extensões
`btree_gist`, `pgcrypto`, `uuid-ossp`; papéis; esquema de `public`; tabela e dados de
`supabase_migrations`; dados de `public`; dados de `auth`. Ajustes necessários (registrar no
procedimento real): executar como `supabase_admin` (donos de função e `SET ROLE` do papel
`bslog_rpc_operacional`); criar as extensões antes do esquema (restrições de exclusão usam
`gist` sobre `uuid`); criar `supabase_migrations.schema_migrations` antes dos dados; a tabela
transitória `auth.one_time_tokens` diverge entre versões do GoTrue (a coluna `expires_at` não
existe no local) e foi a **única** falha, sem impacto (são tokens efêmeros).

Resultado: head `20261101120000`, **todas as contagens e somas iguais às de Production** (profiles
10, user_roles 9, admin_audit_log 33, financial_terms_audit 1, auth.users 3, mfa_factors 1, demais
tabelas 0, motor ligado), e **catálogo idêntico**: 21 tabelas, 120 funções, 65 gatilhos, 70 políticas,
59 índices, 123 restrições, 21 tabelas com RLS e o mesmo `md5` do código de todas as funções
de `public` (`9668570d9a589b4be7f3b5588b5276a1`). O backup é válido **enquanto Production
não receber escrita**; qualquer cadastro novo exige um dump novo antes da janela.

## 5. Verificação de dependências e dados

- Os scripts `scripts/comparar-catalogo-*.sh` trabalham **somente no Supabase local** e comparam
  o catálogo antes e depois de **uma** migration (e da sua reversão); eles **não** leem Production.
  Para Production, restaure o backup novo (seção 4) num banco local isolado, aplique 035 → 045 nele
  e compare o catálogo resultante (funções, assinaturas, triggers, grants, RLS e papéis) com o do HML
  (por leitura) e com o do próprio backup antes das migrations.
- Conferir dados que as migrations tocam: contratos sem vigência (038), turnos sem período
  e colaboradores sem função (039–041), lançamentos legados (042–043), operações sem
  localidade (044), unicidade por colaborador/operação/data, faturas existentes e vínculos.
- Registrar contagens e somas financeiras **antes** (linha de base) para a comparação final.
- Ler as flags: `financial_engine_settings`, `pricing_settings`.

## 6. Controle do deploy

- A `main` publica Production **antes** da CI terminar. Durante a janela, **não mergear** na
  `main`; se necessário, pausar o deploy automático na Vercel e registrar como foi feito e
  como será restaurado. O código atual já é compatível com 034 e 045 (suíte de compatibilidade);
  portanto a implantação do banco **não exige novo deploy**.
- Anotar o deployment ativo (ID e SHA) antes e depois, para reversão de aplicativo, se for o
  caso. Rollback de aplicativo só com candidato comprovado e autorização; não por tentativa.

## 7. Ordem de execução (somente com autorização)

1. Reler o head (034) e o backup do passo 4 (SHA conferido).
2. Aplicar **035 → 045, na ordem numérica**, uma a uma, cada uma em transação, por `supabase
db push --linked --dry-run` seguido da aplicação, ou pelo SQL Editor com transação guardada
   (`GET DIAGNOSTICS` por comando), o que a pessoa responsável autorizar. Entre uma migration e a
   próxima, conferir erro zero e head atualizado.
3. Parar na **primeira** falha: não pular, não editar a migration. Avaliar com a seção 8.
4. Verificações pós-migration:
   - head = `20261112120000` (045) e 50 registros;
   - catálogo igual ao do ensaio (funções, triggers, grants, RLS, `bslog_rpc_operacional`);
   - flags: motor como antes; **resolução comercial OFF**;
   - nenhuma linha financeira alterada: somas e contagens iguais à linha de base;
   - faturas existentes inalteradas.
5. **Smoke autenticado** (conta admin e conta operacional de Production, autorizadas):
   login; `/dashboard`; `/fechamento` de um cliente/período já fechado com valores iguais aos
   de antes; `/containers` (lista vazia) e abrir `/containers/novo`; `/operacional` com a conta
   operacional vendo só o que lhe foi atribuído e sem valores; sem erro 5xx nos logs.
6. **Testes financeiros** (sem gravar dado real): comparar o Fechamento e o Excel de um período
   existente antes/depois (diferença zero em centavos); nenhum lançamento de teste em
   Production sem autorização — se necessário, usar o ensaio local.

## 8. Critérios de interrupção

Interromper e não prosseguir se: (a) qualquer migration falhar ou pedir alteração; (b) o
catálogo divergir do ensaio; (c) qualquer soma ou contagem financeira mudar; (d) falha de
login, MFA ou RLS (operacional enxergando tabela de negócio); (e) 5xx novo nos logs; (f) o
backup não restaurar; (g) a janela estourar; (h) qualquer dúvida da pessoa responsável.

## 9. Recuperação

1. **Não** reexecutar nem editar a migration que falhou.
2. Se a falha ocorreu **dentro** da transação, nada foi aplicado: reavaliar com o ensaio local.
3. Se a migration foi aplicada e a verificação falhou: usar o SQL de reversão **específico** em
   `docs/runbooks/rollback-*.sql`, na ordem inversa (045 → 035), **somente** após conferir as
   condições comuns do [índice de runbooks](README.md) (a 034 em particular não pode ser
   revertida diretamente sobre schemas posteriores). Cada reversão com autorização própria.
4. Restauração completa do backup é o **último** recurso (perde o que foi gravado depois do
   dump) e exige decisão explícita.
5. Registrar tudo no HANDOFF e no Estado do projeto.

## 10. Depois da implantação (decisões separadas)

- **Resolução comercial por função/período** em Production: só depois de cadastrar tarifas
  e diárias individuais, classificar os turnos, registrar locais/coberturas do calendário, com
  homologação do cálculo e autorização específica; reversível (`alterar_resolucao_tarifas`).
- Homologar com a BS: decisões comerciais em aberto (Dashboard por cliente; custo de
  Containers na margem; Dynamis).
- Manual de uso ([MANUAL_DE_USO](../MANUAL_DE_USO.md)) e treinamento antes de abrir Containers
  ao uso diário.
