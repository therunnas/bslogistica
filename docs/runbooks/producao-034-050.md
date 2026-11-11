# Production 034 → 050 — plano de implantação

SDLC: Deploy. **Plano, nada executado.** Substitui, para esta implantação, a ordem de execução de
[producao-034-045.md](producao-034-045.md), cujo ensaio (034 → 045 sobre cópia restaurada de
Production, 05/11/2026, sem erro) continua sendo evidência. Execução somente com autorização
nominal do responsável, na janela combinada, com ele presente.

## 1. Estado de partida (lido em 11/11/2026, somente leitura, Management API e API da Vercel)

| Item                | Production `ehkduqokntemtmqzdrbd`                                                                                                                                                                                                                                                                                                                                                   | HML `qbnfcmrxmssnwkhaitgd` (referência)                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Migrations          | 39, última `20261101120000` (034), md5 `5402571acffc58fc5384c7b91030a702`                                                                                                                                                                                                                                                                                                           | 55, última `20261117120000` (050), md5 `01ca91361b85841984ee708716ee60ac` |
| Faltam              | exatamente 035–050 (16), todas posteriores à última aplicada; nenhuma versão fora do repositório                                                                                                                                                                                                                                                                                    | —                                                                         |
| Dados de negócio    | nenhum: 0 operações, contratos, colaboradores, apontamentos, faturas e adicionais; 1 cliente de teste ("te", 09/11/2026)                                                                                                                                                                                                                                                            | só sintéticos                                                             |
| Contas              | 3 em `auth.users` (1 admin, 1 operacional com TOTP, 1 sem papel); 7 `profiles` e 7 `user_roles` órfãos de contas apagadas                                                                                                                                                                                                                                                           | 17                                                                        |
| RLS                 | ligada nas 21 tabelas de `public`                                                                                                                                                                                                                                                                                                                                                   | ligada nas 31                                                             |
| Motor por vigência  | ligado desde 29/10/2026                                                                                                                                                                                                                                                                                                                                                             | ligado                                                                    |
| Resolução comercial | `pricing_settings` ainda não existe (nasce na 041 com `false`)                                                                                                                                                                                                                                                                                                                      | `false`                                                                   |
| PostgreSQL          | 17.6, 14 MB                                                                                                                                                                                                                                                                                                                                                                         | —                                                                         |
| Auth                | Site URL `https://admin.bslogisticas.com.br`; cadastro público desligado; confirmação de e-mail ligada; TOTP ligado; link expira em 3600 s; SMTP Resend 587, `nao-responda@envio…`; assuntos em português; modelo de recuperação `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` (correto); modelo de convite com `{{ .ConfirmationURL }}` (decisão abaixo) | —                                                                         |
| Vercel              | projeto `prj_K1OJ6G7AWnx6dQB1BDsy3HTELnCV`, Production Branch `main`, `git.deploymentEnabled.main: false`, domínios atribuídos automaticamente; `NEXT_PUBLIC_SUPABASE_URL` de Production → `ehkduq…`; de Preview (todas as branches e `staging`) → `qbnfcm…`                                                                                                                        | —                                                                         |
| Site publicado      | `dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4`, SHA `38b4349`, 05/11/2026                                                                                                                                                                                                                                                                                                                       | —                                                                         |

## 2. Pré-condições

| #   | Pré-condição                                                                    | Situação em 11/11/2026                                                                                                |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Backup novo de Production (`pg_dump -Fc`) e índice legível                      | feito pelo responsável: 1.510 itens em `pg_restore -l`                                                                |
| 2   | Segunda cópia do backup fora da máquina                                         | feita pelo responsável (11/11/2026)                                                                                   |
| 3   | Modelos e configuração de e-mail conferidos                                     | feito por leitura (seção 1)                                                                                           |
| 4   | Decisão do convite                                                              | opção A escolhida pelo responsável (11/11/2026): primeiro acesso por "Esqueci minha senha"; nada muda na configuração |
| 5   | Código a publicar                                                               | `main` `d33e8b2` (#119–#126 mesclados), CI verde; não mergear nada na `main` durante a janela                         |
| 6   | Janela com o responsável presente e autorização nominal ("autorizo Production") | janela em 11/11/2026, com o responsável presente; autorização nominal pedida antes do primeiro passo                  |

## 3. Método

Uma migration por vez, pela Management API, com
[`aplicar-migration-api.py`](aplicar-migration-api.py) — o mesmo método usado no HML para 046–050
em 09/11/2026:

- cada arquivo roda **sem alteração**, dentro do seu próprio `BEGIN … COMMIT`, e o registro em
  `supabase_migrations.schema_migrations` entra **na mesma transação**: ou entra tudo, ou nada;
- antes: confere que a última versão é a anterior esperada (nada fora de ordem);
- depois: confere versão nova, nenhuma tabela de `public` com menos linhas, nenhuma sem RLS,
  motor e tarifas iguais. Divergência = parar.
- Modo padrão do script é só conferência; aplicar exige `--executar` e
  `BS_CONFIRMO_PROJETO=ehkduqokntemtmqzdrbd`.

As 16 migrations terminam no próprio `COMMIT`, sem `CONCURRENTLY` nem comando de superusuário
(conferido no repositório). O executor remoto é o `postgres` hospedado (não superusuário): a
aplicação das mesmas versões no HML hospedado é a evidência de que os privilégios bastam.

## 4. Ordem de execução na janela

1. **Reconferir por leitura:** última versão `20261101120000`, 39 migrations, md5 acima; nenhuma
   escrita nova em Production desde o backup (contagens da seção 1). Se algo mudou, parar e
   decidir se é preciso backup novo.
2. **Anotar o deployment ativo** (`dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4`), para a reversão do site.
3. **Aplicar 035 → 050, em ordem**, cada uma com o script (conferência, depois `--executar`),
   parando na primeira falha.
4. **Conferir o banco final:** 55 migrations, última `20261117120000`, md5
   `01ca91361b85841984ee708716ee60ac` (igual ao HML); RLS em todas as tabelas;
   `pricing_settings.tarifas_por_funcao = false`; motor ligado com `ativada_em` 29/10/2026;
   CHECK `requested_on <= executed_on`; `registrar_adicional` sem `EXECUTE` para
   `authenticated`; gatilhos de fatura presentes; o cliente "te" e as contas intactos.
5. **Publicar o site** com o SHA atual da `main`, pela API da Vercel (a trava `main:false` vale
   só para publicações disparadas pelo Git):
   `POST https://api.vercel.com/v13/deployments?teamId=team_fk1UOQV41n2UpOT12bX1GBAC` com
   `{"name":"bs-logistica-sistema","project":"prj_K1OJ6G7AWnx6dQB1BDsy3HTELnCV","target":"production","gitSource":{"type":"github","repoId":1356283351,"ref":"main","sha":"<SHA da main>"}}`;
   aguardar `READY` e conferir que `admin.bslogisticas.com.br` passou para o novo deployment.
6. **Smoke** (o responsável faz o login; nada é gravado): `/login`; `/dashboard`; Operações;
   Clientes; Faturamento abre sem erro; `/containers` abre por URL; com a conta operacional,
   `/operacional` sem valores e `/dashboard` redirecionando.

**Entre os passos 3 e 5** o site antigo (`38b4349`) roda sobre o banco novo por alguns minutos.
Ele chama `registrar_adicional`, que a 047 revoga: registrar adicional falharia nesse intervalo.
Sem dados de negócio nem uso real, o impacto é nulo; recomenda-se não usar o site durante a janela.

## 5. Critérios de parada

- falha de qualquer migration, de qualquer conferência do script ou do passo 4;
- leitura que não confira com a seção 1 antes de começar;
- deployment que não fique `READY`, ou domínio que não troque;
- erro 5xx, tela que não abre ou login que falha no smoke.

## 6. Recuperação

- **Migration que falha:** a transação dela é desfeita sozinha; as anteriores continuam
  aplicadas. Não reaplicar, não editar a migration, não apagar linha de `schema_migrations`.
  Registrar o erro, manter o site antigo (não fazer o passo 5) e decidir com o responsável.
  O código atual é compatível com 034 e 045 (suíte de compatibilidade); entre 046 e 050 não há
  ensaio de banco parcial.
- **Site com problema:** promover de volta o deployment anotado no passo 2
  (`POST https://api.vercel.com/v10/projects/prj_K1OJ6G7AWnx6dQB1BDsy3HTELnCV/promote/dpl_6VwWi2m2tGfrAWcqYZdJH74Ay5E4?teamId=team_fk1UOQV41n2UpOT12bX1GBAC`).
  Com o banco já na 050, o site antigo perde só o registro de adicionais (ver seção 4).
- **Restauração do backup:** último recurso, com autorização própria; perde o que for escrito
  depois do dump.

## 7. Depois (decisões separadas)

- limpar os 7 `profiles` e 7 `user_roles` órfãos (tarefa própria, por UUID exato);
- convite (opção A, B ou C do checklist);
- matriz E2E de acesso antes de criar contas operacionais reais;
- segunda cópia do backup, se ainda não feita.
