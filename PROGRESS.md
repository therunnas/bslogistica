# BS Logística — Project Checkpoint

Checkpoint dinâmico. Regras permanentes ficam em [CLAUDE.md](CLAUDE.md).

## 1. Checkpoint

| Item                      | Valor                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| Data/hora                 | 2026-09-10 19:04                                                                           |
| Branch                    | `main`                                                                                     |
| HEAD                      | `1f72eb740b1835e794a213ac37b02c2dc3416ff6`                                                 |
| `origin/main`             | `1f72eb740b1835e794a213ac37b02c2dc3416ff6` — idêntico, 0 à frente / 0 atrás                |
| Working tree              | limpa antes deste checkpoint                                                               |
| Alterações não commitadas | **apenas `CLAUDE.md` e `PROGRESS.md`**, criados por este checkpoint e ainda não commitados |
| Último commit             | `1f72eb7` Merge pull request #10 from therunnas/fix/mfa-aal-error-handling                 |

Nenhum código de aplicação, migration, configuração de infraestrutura ou dado
foi alterado por este checkpoint.

## 2. Ambiente

|                 |                                                       |
| --------------- | ----------------------------------------------------- |
| Projeto local   | `C:\Users\VINICIUS\Documents\BS Logistics`            |
| GitHub          | `therunnas/bslogistica`                               |
| Produção        | `https://admin.bslogisticas.com.br`                   |
| Supabase atual  | `ehkduqokntemtmqzdrbd`                                |
| Supabase antigo | `qaibhlucbpetxrtswulf` — **apagado**, não existe mais |

**Site institucional é outro projeto:** `https://bslogisticas.com.br`,
repositório `therunnas/PROJETO-BS-LOGISTICA`, pasta
`C:\Users\VINICIUS\Documents\GitHub\PROJETOS\BS Logistica`. Nunca tocar.

O domínio tem **"s"** em "logisticas". Documentação antiga já foi corrigida.

O projeto Supabase original foi **excluído acidentalmente**. O banco foi
reconstruído a partir das migrations versionadas em um projeto novo. **A
reconstrução está concluída e validada** — não refazer.

## 3. Recuperação do Supabase — CONCLUÍDA

| Verificação                       | Resultado                                       |
| --------------------------------- | ----------------------------------------------- |
| Migrations                        | 14 local / 14 remoto / 0 divergências           |
| RLS                               | 12/12 tabelas                                   |
| Policies                          | 19                                              |
| Órfãos e FKs                      | 14 verificações, todas em 0                     |
| Smoke test funcional pela UI real | **PASS**                                        |
| Fixtures `ZZ-SMOKE`               | removidas; banco de negócio em 0 nas 10 tabelas |

Teste financeiro ponta a ponta, conferido no banco (não só na tela):

|            |               |
| ---------- | ------------- |
| Trabalhado | 600 min       |
| Hora extra | 120 min       |
| Diária     | R$ 200,00     |
| Hora extra | R$ 37,50/h    |
| Receita    | **R$ 275,00** |
| Custo      | **R$ 125,00** |
| Margem     | **R$ 150,00** |

**Segunda diária:** bloqueada corretamente — faixa de conflito na UI, botão
Salvar desabilitado, e o índice único
`timesheet_entries_uma_diaria_por_operacao_dia` presente, `unique` e `valid`
no banco. **Faturamento:** PASS — fatura fechada, itens somando exatamente o
total, `invoice_id` vinculado, lançamento não reelegível.

## 4. Auth e segurança — estado confirmado

|                                                               |                                        |
| ------------------------------------------------------------- | -------------------------------------- |
| Admin                                                         | `contato@bslogisticas.com.br`          |
| UUID                                                          | `61d892b4-abb3-4e55-b5e1-9795a3476d96` |
| Papel                                                         | `admin`                                |
| MFA                                                           | TOTP `verified`                        |
| `auth.users` / `profiles` / `user_roles` / `auth.mfa_factors` | 1 / 1 / 1 / 1                          |
| `disable_signup`                                              | `true`                                 |
| `external.email`                                              | `true`                                 |
| `external.phone`                                              | `false`                                |
| Site URL                                                      | `https://admin.bslogisticas.com.br`    |
| `additional_redirect_urls`                                    | `[]`                                   |

Preservado e a preservar: sem self-signup; papéis explícitos e nunca
automáticos; nenhuma `service_role` no client; nenhuma chave privilegiada no
frontend; MFA obrigatório; guard por papel no servidor; **`supabase config
push` só com auditoria explícita** (o `config.toml` não descreve o Auth real e
um push desligaria MFA e a Site URL).

## 5. Migrations arquiteturalmente relevantes

Não há SQL reproduzido aqui — abrir o arquivo quando precisar.

| Arquivo                                               | Por que importa                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `20260903200000_create_rls_auto_enable.sql`           | RLS ativada automaticamente em tabela nova de `public`                    |
| `20260905163000_005_gerar_fatura_transacional.sql`    | faturamento numa única transação, totais somados no servidor              |
| `20260906180000_008_unicidade_diaria.sql`             | índice único: uma diária faturável por colaborador/operação/data          |
| `20260909175432_remove_automatic_admin_bootstrap.sql` | onboarding cria só o profile; papel virou ato administrativo              |
| `20260909175435_protect_timesheet_invoice_link.sql`   | só admin altera `timesheet_entries.invoice_id`                            |
| `20260909175439_remove_legacy_daily_exception.sql`    | removeu a exceção histórica do índice de diária — hoje o índice é estrito |
| `20260910111219_restringir_trigger_chave_diaria.sql`  | trigger da chave de diária restringido                                    |

Testes SQL em `supabase/tests/` (4 arquivos, todos PASS quando executados por
último). `004_exclusao_cliente_faturado.sql` cobre exclusão/cascade de cliente
com fatura.

## 6. MFA

- Fluxo AAL2 validado ponta a ponta em produção.
- **Refresh de token mantém AAL2** — o nível vive em `auth.sessions.aal`, não
  só no token. Navegação, F5 e nova aba **não** devem pedir TOTP de novo
  enquanto a sessão for válida.
- Logout, sessão nova ou outro navegador **devem** exigir o TOTP.
- Erro transitório ao consultar o nível **não** é tratado como ausência de
  fator: vai para a tela "não foi possível verificar", nunca para o cadastro.
  Decisões isoladas em `src/lib/mfa.ts`; `npm run test:mfa` (13 testes) cobre.

**Pendência, não corrigir agora:** `src/app/mfa/painel-mfa.tsx` ainda exibe
`error.message` cru do GoTrue em dois pontos (`listFactors` e `enroll`).
Pré-existente, não introduzido pelo PR #10.

## 7. Vercel

Production usa o Supabase novo e está saudável.

**Preview não tem as variáveis `NEXT_PUBLIC_SUPABASE_*`, de propósito** — por
isso o build de Preview falha na pré-renderização. Isso é ambiental, não um
defeito do código: `main` falha igual sem as variáveis. **Não conectar Preview
ao banco de produção só para deixar o check verde.**

Pendência: decidir se Preview Deployments será desabilitado neste repositório.

## 8. Etapa atual — e-mail / SMTP

A recuperação do Supabase **terminou**. A etapa atual é
**infraestrutura de e-mail do Supabase Auth**.

Estado auditado em 10/09/2026:

| Item                                      | Estado                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Google Workspace em `bslogisticas.com.br` | ativo                                                                     |
| MX                                        | `SMTP.GOOGLE.COM`                                                         |
| DKIM Google (`google._domainkey`)         | **publicado e ativo**                                                     |
| SPF (TXT do ápice)                        | **ausente**                                                               |
| DMARC (`_dmarc`)                          | **ausente**                                                               |
| Custom SMTP no Supabase                   | **não configurado** (usando o serviço embutido, ~2 e-mails/hora, sem log) |
| Resend                                    | **não configurado**                                                       |
| Nameservers                               | `cosmos.dns-parking.com` / `nova.dns-parking.com` → DNS na **Hostinger**  |
| `envio.bslogisticas.com.br`               | NXDOMAIN, zona limpa                                                      |

Fluxos ausentes no código (só existe `signInWithPassword` em
`src/app/login/page.tsx`): recuperação de senha, convite de usuário, definição
inicial de senha, `/auth/confirm`, reset de MFA.

**Decisão arquitetural tomada:** Resend como provedor transacional, no
subdomínio `envio.bslogisticas.com.br`. Google Workspace continua responsável
pelo e-mail humano; o MX do ápice não é tocado. Remetente recomendado:
`nao-responda@envio.bslogisticas.com.br` — o Resend só aceita enviar de dentro
do domínio verificado, e o subdomínio dá alinhamento estrito de DKIM e
isolamento de reputação. Consequência aceita: o subdomínio não recebe e-mail.

## 9. Próximo passo exato

**Etapa DNS — manual, ainda não executada.**

1. Criar `dmarc@bslogisticas.com.br` como **alias** de
   `contato@bslogisticas.com.br` no Google Workspace (alias não consome
   licença).
2. Na Hostinger (hPanel → Domínios → `bslogisticas.com.br` → DNS):

| Tipo  | Nome/Host | Valor                                                    | TTL    |
| ----- | --------- | -------------------------------------------------------- | ------ |
| `TXT` | `@`       | `v=spf1 include:_spf.google.com ~all`                    | `3600` |
| `TXT` | `_dmarc`  | `v=DMARC1; p=none; rua=mailto:dmarc@bslogisticas.com.br` | `3600` |

**Antes de criar o SPF: confirmar que não existe outro registro `v=spf1` no
`@`.** Dois SPF no mesmo host geram `permerror` e derrubam a autenticação
inteira. No último diagnóstico não havia nenhum.

**Não alterar** o MX do Google, o TXT `google-site-verification` nem o
`google._domainkey`.

3. **Parar e validar o DNS** pelos resolvers públicos antes de seguir.

Só depois da validação começa a configuração do Resend.

## 10. Sequência futura

DNS SPF/DMARC → validar → Resend → verificar `envio.bslogisticas.com.br` →
Custom SMTP no Supabase → testar entrega real → `/auth/confirm` → definir senha
→ recuperação de senha → convite server-side → estratégia segura de reset de
MFA → endurecimento do DMARC.

Referência para a etapa do Resend, já apurada na documentação oficial: domínio
verificado exige `MX` em `send` (bounce/feedback), `TXT` SPF em `send` e `TXT`
DKIM em `resend._domainkey`; SMTP é `smtp.resend.com`, porta `587`, username
literal `resend`, password = API Key. **Os valores concretos saem do painel do
Resend — não inventar.** Na Hostinger os nomes são relativos (`send.envio`,
`resend._domainkey.envio`), porque o painel acrescenta o domínio sozinho.

## 11. Pendências

| Prioridade         | Pendência                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **P1 operacional** | SMTP / e-mails de Auth — bloqueia convite, recuperação de senha e onboarding                                                     |
| P2                 | Fluxo administrativo de usuários (convite server-side com chave secreta e guarda de papel)                                       |
| P2                 | Recuperação/reset seguro de MFA — hoje um usuário que perde o TOTP fica travado; com um único admin, não há saída pela aplicação |
| P3                 | Mensagens cruas do SDK em `painel-mfa.tsx`                                                                                       |
| P3                 | Decidir sobre Vercel Preview Deployments                                                                                         |

Observação menor registrada e não investigada: `config diff` mostra
`auth.sms.twilio.enabled = true` no remoto enquanto `external.phone` é `false`.
Provedor de telefone está desligado; vale conferir a origem da flag numa
próxima passagem pelo Dashboard.

## 12. Não fazer

- Não reconstruir o Supabase de novo.
- Não reaplicar migrations já aplicadas.
- Não usar `supabase config push`.
- Não ativar signup público.
- Não expor `service_role`, nem colocar segredo em `NEXT_PUBLIC_*`.
- Não conectar Preview ao banco de produção só para passar o check.
- Não modificar DNS sem confirmação.
- Não configurar o Resend antes de validar SPF/DMARC.
- Não implementar telas de Auth antes de provar a entrega pelo SMTP.
- Não tocar no site institucional.

## 13. Como retomar após `/clear`

Para retomar em uma sessão limpa:

1. leia `CLAUDE.md`;
2. leia `PROGRESS.md`;
3. confira `git status` e HEAD;
4. não reaudite todo o projeto sem necessidade;
5. continue somente da seção **Próximo passo**;
6. se o estado real divergir do checkpoint, pare e reporte a divergência.

**Documentos com conteúdo obsoleto — não confie neles sem verificar:**

- `docs/ESTADO_DO_PROJETO.md` — fotografia de 04/09/2026: fala em 7 migrations,
  PR #1 aberto, produção não publicada e nenhum domínio. Tudo isso mudou.
- `docs/divida-tecnica/rls-vinculo-de-fatura-permissivo.md` — marcado como "não
  corrigida", mas a migration `20260909175435_protect_timesheet_invoice_link`
  resolveu o caso.

Atualizar esses dois é trabalho pendente e fora do escopo deste checkpoint.
