# BS Logística — Project Checkpoint

Checkpoint dinâmico. Regras permanentes ficam em [CLAUDE.md](CLAUDE.md).

## 1. Checkpoint

| Item           | Valor                                                |
| -------------- | ---------------------------------------------------- |
| Data/hora      | 2026-09-11                                           |
| Branch atual   | `security/enforce-aal2-rls`                          |
| Base da branch | `main` em `a8ae03c9f51e925dcd6f79c7d55c3a0c384501b6` |
| `origin/main`  | `a8ae03c` — idêntico ao `main` local                 |

Há **duas frentes abertas ao mesmo tempo**, e a ordem entre elas importa:

| Frente            | Branch                      | Estado                                     |
| ----------------- | --------------------------- | ------------------------------------------ |
| Password recovery | `feat/password-recovery`    | PR #13 aberto, **congelado**, não mergeado |
| Enforcement AAL2  | `security/enforce-aal2-rls` | validado local, **sem commit até agora**   |

**O AAL2 é mergeado primeiro.** Ver seção 8.

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

O domínio tem **"s"** em "logisticas".

A reconstrução do Supabase está **concluída e validada** — não refazer.

## 3. Auth, MFA e branding — estado consolidado

|                  |                                        |
| ---------------- | -------------------------------------- |
| Admin            | `contato@bslogisticas.com.br`          |
| UUID             | `61d892b4-abb3-4e55-b5e1-9795a3476d96` |
| Papel            | `admin`                                |
| MFA              | TOTP `verified`                        |
| `disable_signup` | `true`                                 |
| Site URL         | `https://admin.bslogisticas.com.br`    |

Branding provisório do MVP em produção (PRs #11 e #12): logo em
`/branding/bs-logo-temp.png`, login, sidebar, home e favicon derivado da
própria marca. O favicon residual da Lovable foi removido.

**E-mail/SMTP já funciona:** Supabase → Resend → Gmail, com SPF, DKIM e DMARC
PASS. Remetente `BS Soluções Logísticas <nao-responda@envio.bslogisticas.com.br>`.

## 4. PR #13 — PASSWORD RECOVERY

**Branch:** `feat/password-recovery`
**HEAD congelado:** `7ce1a1d85a0ec291e4d8221f2e0ff1000afc9c10`

**Estado:**

- PR #13 aberto;
- **NÃO mergeado**;
- password recovery implementado;
- prova HMAC server-side;
- revalidação da prova no submit;
- `updateUser` server-side;
- `signOut` global após troca bem-sucedida;
- limpeza **local** da sessão quando `verifyOtp` já criou sessão e etapa
  posterior falha;
- `PASSWORD_RECOVERY_PROOF_SECRET` necessário em Production — **já criado
  manualmente na Vercel, somente no escopo Production**;
- template Reset Password do Supabase **AINDA NÃO foi alterado**;
- **PR #13 NÃO pode ser mergeado antes do enforcement AAL2 no banco.**

Cinco commits: `702d353`, `ce29689`, `6ac3471`, `313481f`, `7ce1a1d`.

Suítes do PR #13: `test:recuperacao` 63/63, `test:prova` 71/71,
`test:troca` 48/48, `test:mfa` 13/13. CodeRabbit: `Review completed`, sem
achados. Vercel Preview vermelho pelo motivo de sempre — ausência proposital
das `NEXT_PUBLIC_SUPABASE_*` no ambiente Preview.

### Achado residual aceito

**P2 residual no signOut local:** `@supabase/auth-js` 2.115.0 já remove a
sessão local em falhas remotas comuns (verificado no fonte instalado,
`GoTrueClient.js:3425-3436`); há caminho residual estreito de falha de leitura
de sessão. **Não vamos manipular cookies internos `sb-*` manualmente** — isso
acoplaria a aplicação a detalhe de implementação do SDK. O risco relevante
será mitigado pelo enforcement AAL2 no banco.

### Passo manual pendente do PR #13

Depois do deploy das rotas, colar o HTML do Reset Password em
**Authentication → Emails → Templates → Reset Password**, com o botão
apontando para
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
Colar antes do deploy deixa o link em 404.

## 5. AAL2 / RLS — trabalho atual

**Branch:** `security/enforce-aal2-rls`
**Base:** `main` em `a8ae03c9f51e925dcd6f79c7d55c3a0c384501b6`

**Migration:** `supabase/migrations/20260911140000_009_enforce_aal2.sql`

**Objetivo — P1:** MFA anteriormente aplicado somente na camada da aplicação.
Sessão AAL1 com papel válido conseguia acessar dados diretamente via
Supabase/PostgREST/RPC. O guard do Next exigia AAL2 para a tela; as policies
olhavam só papel.

**11 tabelas protegidas por policy RESTRICTIVE AAL2:**

`profiles` · `clients` · `contracts` · `employees` · `operations` · `shifts` ·
`operation_team` · `timesheets` · `timesheet_entries` · `invoices` ·
`invoice_items`

Forma da policy, idêntica nas 11:

```sql
AS RESTRICTIVE FOR ALL TO authenticated
USING      ((SELECT auth.jwt() ->> 'aal') = 'aal2')
WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');
```

Fail-closed sem `COALESCE`: `->>` devolve `NULL` com o claim ausente,
`NULL = 'aal2'` é `NULL`, e a RLS trata `NULL` como não-permitido.

**`user_roles` fica deliberadamente SEM enforcement AAL2** porque é consultada
antes do MFA (`src/app/(painel)/_autorizacao.ts`) e bloqueá-la causaria
deadlock login → MFA.

**`gerar_fatura`:**

- continua `SECURITY DEFINER`;
- mesma assinatura;
- mesmo `search_path`;
- mesmos grants/revokes;
- recebeu check explícito de `aal2`, antes da verificação de papel.

Policy RESTRICTIVE não protege função `SECURITY DEFINER`, que roda acima da
RLS — daí a verificação dentro da própria função.

## 6. Validação local real

Docker + WSL2 configurados e funcionando.

**Versões validadas:** Docker **29.7.2** · Supabase CLI **2.117.0** ·
PostgreSQL local **17.6.1.166**.

**Stack usada SOMENTE LOCAL:**

| Serviço  | Endereço          |
| -------- | ----------------- |
| API      | `127.0.0.1:54321` |
| Postgres | `127.0.0.1:54322` |
| Studio   | `127.0.0.1:54323` |
| Mailpit  | `127.0.0.1:54324` |

Nenhum comando remoto. Nenhum `db push`. Nenhum `--linked`. **Production não
foi tocada.** O `db reset` reportou `{"target":"local"}`.

### Baseline antes da 009

`005` antes da migration: **22 FAIL / 16 PASS.** A vulnerabilidade foi
reproduzida de verdade, em PostgreSQL real:

- admin AAL1 lia `clients` (2 linhas);
- admin AAL1 lia `employees` (4 linhas);
- admin AAL1 lia `invoices`;
- admin AAL1 lia `profiles`;
- admin AAL1 podia INSERT/UPDATE/DELETE em `clients`;
- operacional AAL1 conseguia ler, inserir, editar e apagar `timesheet_entries`;
- sem claim `aal` tudo passava;
- `gerar_fatura` funcionava em AAL1.

Isso provou que o teste detecta o problema real — não passa por expectativa
invertida.

### Depois da 009

| Suíte | Resultado      |
| ----- | -------------- |
| `005` | **38/38 PASS** |
| `001` | PASS           |
| `002` | PASS           |
| `003` | PASS           |
| `004` | PASS           |

Também confirmado:

- `user_roles` AAL1 continua legível para a própria role (1 linha própria,
  0 alheias);
- `profiles` AAL1 bloqueado;
- `profiles` AAL2 preservado;
- `gerar_fatura` admin AAL1 → **42501**;
- `gerar_fatura` admin AAL2 → funciona;
- **11 policies RESTRICTIVE confirmadas em `pg_policies`**, todas
  `{authenticated}`, `cmd=ALL`, com `aal` em `USING` e em `WITH CHECK`;
- RLS **12/12** tabelas;
- policies de papel existentes preservadas.

O `002` recusou `gerar_fatura` com "Apenas administradores podem gerar
faturas" — prova de que a barreira foi a **regra de papel**, não a de AAL, e
de que acrescentar `aal2` aos claims não criou falso positivo.

**App:** `test:mfa` 13/13 · lint 0 erros, apenas warning preexistente ·
TypeScript PASS · build PASS · `git diff --check` PASS.

## 7. Achados menores registrados

**P3 —** `sincronizar_chave_da_diaria` pode retornar `23503` "Folha não
encontrada" numa tentativa AAL1, antes do `WITH CHECK`. O trigger é
`SECURITY INVOKER` e lê `timesheets`, que a policy nova esconde em AAL1.
**A operação continua bloqueada.** É problema de diagnóstico/mensagem,
**NÃO bypass**. Não corrigir no PR AAL2.

**Resíduo de CLI —** `supabase/.branches/` é resíduo local da CLI e não está
no `.gitignore`. Reaparece a cada operação local. **Não alterar o
`.gitignore` nesta etapa.**

**Pendências antigas que seguem abertas:**

- mensagens cruas do SDK em `src/app/mfa/painel-mfa.tsx` (P3);
- decidir sobre Vercel Preview Deployments (P3);
- `auth.sms.twilio.enabled = true` no remoto com `external.phone = false` —
  conferir origem numa passagem pelo Dashboard;
- `docs/ESTADO_DO_PROJETO.md` e
  `docs/divida-tecnica/rls-vinculo-de-fatura-permissivo.md` estão obsoletos.

## 8. PRÓXIMO PASSO

O próximo passo após `/clear` é SOMENTE:

1. confirmar branch `security/enforce-aal2-rls`;
2. confirmar HEAD/base;
3. confirmar `git status`;
4. revisar o diff final dos 3 arquivos;
5. executar checks finais se necessário;
6. commit: `security: enforce aal2 in database authorization`;
7. push da branch;
8. abrir PR para `main`;
9. solicitar `@codex review`;
10. aguardar CodeRabbit;
11. **NÃO mergear**;
12. **NÃO aplicar no Supabase Production.**

Depois que esse PR for revisado e aprovado:

- mergear AAL2 primeiro;
- aplicar/validar migration Production de forma controlada;
- atualizar PR #13 com `main`;
- checks finais;
- só depois merge do password recovery.

> Observação: os passos 6 e 7 divergem do que já aconteceu. O commit do item 6
> **já foi criado** neste checkpoint, com essa mensagem exata. Retomar,
> portanto, a partir do item 7 (push), depois de reconferir 1 a 5.

## 9. Não fazer

- Não reconstruir o Supabase de novo.
- Não reaplicar migrations já aplicadas.
- Não usar `supabase config push`.
- Não ativar signup público.
- Não expor `service_role`, nem colocar segredo em `NEXT_PUBLIC_*`.
- Não conectar Preview ao banco de produção só para passar o check.
- Não modificar DNS sem confirmação.
- Não mergear o PR #13 antes do PR de AAL2.
- Não aplicar a migration 009 em Production sem janela controlada.
- Não adicionar enforcement AAL2 em `user_roles`.
- Não tocar no site institucional.

## 10. Como retomar após `/clear`

1. leia `CLAUDE.md`;
2. leia este arquivo;
3. confira `git status` e HEAD;
4. não reaudite todo o projeto sem necessidade;
5. continue somente da seção **PRÓXIMO PASSO**;
6. se o estado real divergir deste checkpoint, **pare e reporte**.
