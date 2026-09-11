# BS Logística — Project Checkpoint

Checkpoint dinâmico. Regras permanentes ficam em [CLAUDE.md](CLAUDE.md).

## 1. Checkpoint

| Item          | Valor                                      |
| ------------- | ------------------------------------------ |
| Data/hora     | 2026-09-11                                 |
| Branch atual  | `docs/progress-aal2-production`            |
| `main`        | `359dd905bf47ad213968e0f50e0ea198db93866f` |
| `origin/main` | `359dd90` — idêntico ao `main` local       |

**O enforcement AAL2 está concluído: mergeado, aplicado em Production e
validado ponta a ponta.** Detalhe na seção 5.

Resta uma frente aberta:

| Frente            | Branch                    | Estado                          |
| ----------------- | ------------------------- | ------------------------------- |
| Password recovery | `feat/password-recovery`  | PR #13 aberto, **não mergeado** |
| Enforcement AAL2  | — (mergeado em `359dd90`) | **CONCLUÍDO** — PR #14          |

O PR #13 deixou de estar congelado: a condição que o bloqueava — AAL2 valendo
no banco — foi cumprida. Ver seção 8.

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

## 5. AAL2 / RLS — CONCLUÍDO

**PR #14 mergeado** em 2026-09-11.
**Merge commit:** `359dd905bf47ad213968e0f50e0ea198db93866f`

**Migration:** `supabase/migrations/20260911140000_009_enforce_aal2.sql` —
**aplicada em Production**.

**Objetivo — P1 (resolvido):** MFA era aplicado somente na camada da aplicação.
Sessão AAL1 com papel válido conseguia acessar dados diretamente via
Supabase/PostgREST/RPC. O guard do Next exigia AAL2 para a tela; as policies
olhavam só papel. Agora o banco também exige o segundo fator.

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

### Aplicação em Production — 2026-09-11

Aplicada com o procedimento oficial do projeto, CLI **2.117.0** (a mesma versão
já validada), prefixada com `env -u SUPABASE_ACCESS_TOKEN` e precedida de
`--dry-run` para conferir o anúncio antes de confirmar.

O binário `supabase` **não existe no PATH deste ambiente** — nem no Bash, nem no
PowerShell, nem em `node_modules`, nem instalado globalmente. Está no cache do
`npx`, e foi usado por caminho absoluto, de propósito, para impedir que o `npx`
resolvesse uma versão diferente durante operação em Production:

```
C:\Users\VINICIUS\AppData\Local\npm-cache\_npx\6f1b058a4d9555af\node_modules\@supabase\cli-windows-x64\bin\supabase.exe
```

A CLI anunciou e aplicou **somente** `20260911140000_009_enforce_aal2.sql`, com
`seeds: []` e `roles: []`.

| Verificação em Production         | Resultado                                                       |
| --------------------------------- | --------------------------------------------------------------- |
| Histórico de migrations           | **15 local / 15 remoto**, 0 pendentes, 0 inesperadas            |
| Policies `*_exige_aal2`           | **11**, todas RESTRICTIVE / `ALL` / `authenticated`             |
| `USING` e `WITH CHECK` com `aal2` | 11 e 11                                                         |
| AAL2 em `user_roles`              | **0** — isenção deliberada preservada                           |
| Policies permissivas antigas      | **19**, intactas (30 no total)                                  |
| RLS                               | **12/12** tabelas                                               |
| `md5` normalizado de `prosrc`     | `dba82abe905ee54e8cfe358cae2104cd` — idêntico ao arquivo da 009 |

`gerar_fatura` instalada: `SECURITY DEFINER`, assinatura `(uuid, date, date)`,
`RETURNS invoices`, `search_path = public, pg_temp`, owner `postgres`, checks na
ordem `auth.uid` → `aal2` → papel, `EXECUTE` só para `authenticated` e negado
para `anon`.

Testes remotos não destrutivos, em `BEGIN … ROLLBACK`, só leitura, com claims
simulados via `set_config` + `SET LOCAL ROLE authenticated`. Feitos sobre
`profiles`, a única tabela protegida com dado real:

| Cenário                     | Linhas | Veredito                |
| --------------------------- | ------ | ----------------------- |
| `aal=aal1`                  | 0      | bloqueado               |
| claim `aal` ausente         | 0      | bloqueado (fail-closed) |
| `aal=aal2`                  | 1      | acesso preservado       |
| `user_roles` com `aal=aal1` | 1      | legível, sem deadlock   |

`gerar_fatura` em AAL1 → **42501**, "Autenticação de dois fatores obrigatória",
antes de qualquer efeito de negócio. Nada persistiu: as contagens das 12 tabelas
ficaram idênticas depois dos testes.

**Cuidado ao ler esses números:** testes equivalentes sobre `clients` e
`timesheet_entries` passaram, mas são **inconclusivos** — essas tabelas estão
vazias, e "0 linhas" não distingue bloqueio de ausência de dado. Ver seção 7.

### Smoke test manual em Production — APROVADO

Executado pelo usuário no navegador, em 2026-09-11:

- login com senha funcionou;
- **antes do TOTP o painel não foi liberado**;
- TOTP funcionou;
- após AAL2 o painel carregou normalmente;
- módulos abriram sem erro de autorização;
- F5 preservou a sessão;
- nova aba preservou a sessão;
- logout funcionou;
- novo login voltou a exigir TOTP.

`admin.bslogisticas.com.br` → HTTP 200. Vercel Production em `359dd90` →
success.

**Rollout AAL2 validado ponta a ponta.**

## 7. Achados menores registrados

**P3 —** `sincronizar_chave_da_diaria` pode retornar `23503` "Folha não
encontrada" numa tentativa AAL1, antes do `WITH CHECK`. O trigger é
`SECURITY INVOKER` e lê `timesheets`, que a policy nova esconde em AAL1.
**A operação continua bloqueada.** É problema de diagnóstico/mensagem,
**NÃO bypass**. Não corrigir no PR AAL2.

**Resíduo de CLI —** `supabase/.branches/` é resíduo local da CLI e não está
no `.gitignore`. Reaparece a cada operação local. **Não alterar o
`.gitignore` nesta etapa.**

**Production está praticamente vazia de dados de negócio.** Conferido em
2026-09-11, logo após o rollout: `profiles` = 1 e `user_roles` = 1 (o admin); as
10 tabelas de negócio — `clients`, `contracts`, `employees`, `operations`,
`shifts`, `operation_team`, `timesheets`, `timesheet_entries`, `invoices`,
`invoice_items` — têm **0 linhas**. Não é defeito do AAL2 e não bloqueia nada,
mas **limita o que qualquer teste em Production consegue provar**: num banco
vazio, "AAL1 leu 0 linhas" não distingue bloqueio de ausência de dado. Foi por
isso que a prova do enforcement se apoiou em `profiles`. Confirmar se o estado é
esperado antes de tirar qualquer conclusão a partir de contagens.

**Pendências antigas que seguem abertas:**

- mensagens cruas do SDK em `src/app/mfa/painel-mfa.tsx` (P3);
- decidir sobre Vercel Preview Deployments (P3);
- `auth.sms.twilio.enabled = true` no remoto com `external.phone = false` —
  conferir origem numa passagem pelo Dashboard;
- `docs/ESTADO_DO_PROJETO.md` e
  `docs/divida-tecnica/rls-vinculo-de-fatura-permissivo.md` estão obsoletos.

## 8. PRÓXIMO PASSO

O enforcement AAL2 está encerrado. O próximo passo é **atualizar o PR #13
(password recovery) com `main`**:

1. atualizar `feat/password-recovery` (hoje em `7ce1a1d`) com `main` em
   `359dd90`;
2. resolver conflitos, se houver;
3. reexecutar as suítes do PR #13 — `test:recuperacao`, `test:prova`,
   `test:troca`, `test:mfa`;
4. `npm run lint`, `npx tsc --noEmit`, `npm run build`;
5. aguardar revisão;
6. mergear o PR #13;
7. **só depois do deploy das rotas**, colar o HTML do Reset Password em
   **Authentication → Emails → Templates → Reset Password**, com o botão
   apontando para
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
   Colar antes do deploy deixa o link em 404.

Sem bloquear nada, pendente de decisão: popular Production com os dados reais de
negócio (ver seção 7).

## 9. Não fazer

- Não reconstruir o Supabase de novo.
- Não reaplicar migrations já aplicadas.
- Não usar `supabase config push`.
- Não ativar signup público.
- Não expor `service_role`, nem colocar segredo em `NEXT_PUBLIC_*`.
- Não conectar Preview ao banco de produção só para passar o check.
- Não modificar DNS sem confirmação.
- Não mergear o PR #13 sem antes atualizá-lo com `main` e refazer os checks.
- Não reaplicar a migration 009 — já está aplicada em Production (15/15).
- Não adicionar enforcement AAL2 em `user_roles`.
- Não tocar no site institucional.

## 10. Como retomar após `/clear`

1. leia `CLAUDE.md`;
2. leia este arquivo;
3. confira `git status` e HEAD;
4. não reaudite todo o projeto sem necessidade;
5. continue somente da seção **PRÓXIMO PASSO**;
6. se o estado real divergir deste checkpoint, **pare e reporte**.
