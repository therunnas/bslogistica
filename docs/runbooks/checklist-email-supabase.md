# Checklist de conferência manual — e-mails do Supabase (HML e Production)

SDLC: Deploy / Manutenção. **Conferência de leitura feita por uma pessoa com acesso de administrador ao
Dashboard do Supabase.** Não altere nada por este checklist: se algum item divergir, registre e decida
antes. Não envie e-mails reais para testar: use o ensaio isolado da seção 7.

Projetos: **HML** `qbnfcmrxmssnwkhaitgd` · **Production** `ehkduqokntemtmqzdrbd`. Marque cada item
por projeto (HML / PROD). O que já foi lido sem acesso ao Dashboard está na coluna "Já verificado".

## 1. Já verificado (sessões 15 e 16, somente leitura, sem alterar nada)

| Item                                                  | HML                                 | Production                                                                         | Como                             |
| ----------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------- |
| Cadastro público desligado                            | sim                                 | sim                                                                                | `supabase config pull --dry-run` |
| Confirmação de e-mail ligada                          | sim                                 | sim                                                                                | idem                             |
| URLs de redirecionamento extras                       | nenhuma                             | nenhuma                                                                            | idem                             |
| Site URL                                              | Preview `…-git-staging-…vercel.app` | `https://admin.bslogisticas.com.br`                                                | idem                             |
| SMTP próprio (Resend)                                 | sim, porta 465                      | sim, porta 587                                                                     | idem                             |
| Intervalo entre e-mails / limite por hora             | 1 min / 30                          | 1 min / 30                                                                         | idem                             |
| MFA TOTP (inscrição e verificação)                    | ligado                              | ligado                                                                             | idem                             |
| DKIM do domínio de envio (`resend._domainkey.envio…`) | —                                   | publicado (chave RSA de 1024 bits)                                                 | `dig TXT`                        |
| SPF do retorno (`send.envio…`)                        | —                                   | `v=spf1 ip4:… ~all` (softfail), MX de retorno do provedor                          | `dig`                            |
| DMARC                                                 | —                                   | `p=quarantine; pct=100`, relatórios para `ti@bslogisticas.com.br` (raiz e `envio`) | `dig TXT`                        |

Observações: o SPF fica no subdomínio `send.envio…` (retorno do provedor), não na raiz `envio…`; isso
é normal quando o remetente é `@envio…`. O HML usa um **Site URL de Preview** (`git-staging`): links
de recuperação gerados em HML apontam para esse domínio, não para o HML local nem para Production.

## 2. Dashboard → Authentication → Email Templates (NÃO legível pela CLI)

Para **Invite user**, **Reset Password** (recuperação), **Confirm signup** e **Magic Link**/**Change
Email** (se usados): abrir cada modelo e anotar o link do botão.

| Modelo             | O que o app espera                                                      | Verificar                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reset Password** | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` | O link **não** pode ser `{{ .ConfirmationURL }}`. O app só aceita `type=recovery` em `/auth/confirm`, grava o token num cookie e só consome com o clique em **Continuar** (proteção contra leitores automáticos de e-mail). |
| **Invite user**    | decisão pendente (ver seção 3)                                          | Se for `{{ .ConfirmationURL }}`, o link **consome o token no GET** e leva ao `/login` sem sessão (comportamento medido).                                                                                                    |
| **Confirm signup** | irrelevante: cadastro público desligado                                 | Só confirmar que não há link que crie conta.                                                                                                                                                                                |

Conferir também: remetente (`nao-responda@` em Production; `homologacao@` em HML), assunto em português,
ausência de qualquer imagem/script externo, e que o texto não revela dados da conta.

## 3. Decisão pendente: como o convidado define a senha

Medido no ensaio local (modelo **padrão** do convite): o convite cria a conta, o perfil e o papel; o
link do e-mail passa por `/auth/v1/verify`, **consome o token** e redireciona ao `/login` com os tokens
no fragmento da URL, sem abrir sessão. O primeiro acesso só se completa por **"Esqueci minha senha"**.
Opções (a decidir; nada foi alterado):

- **A (menor mudança):** manter o convite, e o texto do e-mail orientar "acesse o painel e use _Esqueci
  minha senha_ com este e-mail". Aceitar que scanners podem consumir o link do convite (sem efeito
  prático, pois a conta já existe e o acesso se faz pela recuperação).
- **B:** o modelo do convite aponta para `{{ .SiteURL }}/esqueci-senha` (sem token na URL).
- **C:** estender o app para aceitar `type=invite` em `/auth/confirm` (mudança de código; fora deste checklist).

## 4. Dashboard → Authentication → URL Configuration

- **Site URL**: Production `https://admin.bslogisticas.com.br`; HML: confirmar se o Preview
  `git-staging` é mesmo o ambiente a usar nos links de homologação.
- **Redirect URLs** (lista de permissão): hoje **vazia**. O app **não** envia `redirectTo` (usa o Site URL),
  então a lista vazia é coerente; qualquer inclusão deve ser pontual e sem curinga.

## 5. Expiração e limites

- Authentication → Providers → Email: **tempo de expiração do link/OTP** (`mailer_otp_exp`; padrão 3600 s)
  — **não legível pela CLI**. Esperado: ≤ 1 hora. Anotar o valor de HML e de Production.
- O app guarda o token pendente em cookie por **300 s** (medido) e o link é de **uso único** (medido: o
  reuso é recusado).
- Rate limit de e-mails: 30 por hora e intervalo mínimo de 1 min (já lidos).
- `otp_length` = 8 (apenas para código numérico, não afeta o link).

## 6. Domínio e entregabilidade (Resend)

- No painel do Resend, o domínio `envio.bslogisticas.com.br` deve estar **Verified** (DKIM, SPF e MX de
  retorno). DNS conferido por leitura: DKIM, SPF e DMARC publicados (seção 1).
- Há `p=quarantine` no DMARC: um remetente desalinhado cai em spam. Enviar **um** e-mail de teste do
  próprio Dashboard (botão de teste de SMTP) **apenas para uma caixa interna** da BS, se a pessoa
  responsável autorizar, e conferir cabeçalhos `SPF=pass`, `DKIM=pass`, `DMARC=pass`.
- Caixa `ti@bslogisticas.com.br` recebe os relatórios DMARC: conferir que existe e é lida.

## 7. Ensaio sem enviar e-mail real (já feito e repetível)

Stack Supabase local (`supabase start` com `project_id` e portas próprios) com **caixa de captura
(Mailpit)** e o app ligado a ela. Colar nela o HTML dos modelos conferidos (`[auth.email.template.*]`
com `content_path`) e repetir: pedido público em `/esqueci-senha`, leitura do e-mail na caixa de captura,
GET duplo no link (não consome), **Continuar**, nova senha, reuso recusado, convite pela tela
Usuários e primeiro acesso. Resultados de 05/11 em `docs/financeiro/homologacao-fin-pr-13.md`
(sessão 14) e em `docs/runbooks/backup-production.md` (Auth restaurado).

## 8. Primeiro acesso — critério de aceite

1. O administrador convida o e-mail e escolhe o papel (padrão: Operacional).
2. A conta, o perfil e o papel existem (Usuários mostra a conta).
3. O convidado consegue definir a senha (por **A**, **B** ou **C** acima) e entra; o operacional vê só
   **Apontamentos**; um convidado sem papel vê "Acesso não liberado".
4. Se o convidado tiver MFA ativo: a recuperação pede **um** código do aplicativo, e o login seguinte pede o código.
