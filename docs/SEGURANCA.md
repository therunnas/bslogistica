# Segurança

Estado verificado em 04/09/2026, projeto Supabase **BSLOG**
(`qaibhlucbpetxrtswulf`).

## Acesso ao sistema

**Cadastro público bloqueado.** `disable_signup = true` — confirmado por leitura
direta da API. Apenas contas existentes conseguem entrar; a criação passa
exclusivamente pelo administrador no painel do Supabase.

O frontend não oferece caminho de cadastro: a tela de login tem apenas e-mail e
senha.

| Papel                 | Acesso                                                            |
| --------------------- | ----------------------------------------------------------------- |
| `admin`               | leitura e escrita em tudo                                         |
| `operacional`         | lê tudo; escreve operações, turnos, equipe, folhas e apontamentos |
| autenticado sem papel | nenhum dado de negócio                                            |
| não autenticado       | redirecionado ao login                                            |

Os quatro perfis foram testados: pela interface e simulando a sessão de cada um
diretamente no banco.

## Proteção no servidor

O layout de `(painel)` verifica a sessão **antes de enviar qualquer HTML**. Sem
sessão, a resposta é HTTP 307 para `/login` — verificado nas sete rotas
protegidas, e nenhuma vaza dado de negócio no corpo da resposta.

Isso substituiu o guard anterior, que rodava apenas depois do JavaScript
carregar no navegador.

## RLS

**A RLS é a camada real de proteção.** O guard governa o que a interface mostra;
se ele tivesse um defeito, as tabelas continuariam protegidas.

- 12 tabelas no schema `public`, **todas com RLS ativa e ao menos uma política**
- Um event trigger (`ensure_rls`) habilita RLS automaticamente em tabelas novas
- Três funções `SECURITY DEFINER` — `handle_bslog_auth_user_created`,
  `provision_bslog_user` e `rls_auto_enable` — com `EXECUTE` restrito a
  `postgres` e `service_role`
- O advisor de segurança do Supabase reporta um único achado, listado nas
  pendências

## Segredos

| Item                      | Estado                       |
| ------------------------- | ---------------------------- |
| `.env`                    | fora do Git, ignorado        |
| `.env.local`              | fora do Git, ignorado        |
| `.env.example`            | versionado, sem valores      |
| `service_role`            | **não usada pela aplicação** |
| Chaves reais no histórico | nenhuma                      |
| Segredos no bundle        | nenhum                       |

O bundle do navegador foi auditado: zero ocorrências de `service_role`,
`sb_secret_` com valor, JWT, ou vazamento de `next/headers` e do cliente de
servidor.

**Nenhuma variável `NEXT_PUBLIC_*` pode conter segredo** — o prefixo faz o Next
embutir o valor no JavaScript servido ao navegador. As duas em uso são públicas
por natureza; quem protege os dados é a RLS.

## Vercel

- Projeto do sistema: `bs-logistica-sistema`, sem domínio customizado
- **Preview protegida por Vercel Authentication**: exige login na Vercel, não é
  acessível publicamente
- Variáveis apenas nos ambientes onde são necessárias
- Sem as variáveis, o build **falha na pré-renderização** com mensagem nomeando
  o que falta — em vez de publicar uma aplicação quebrada
- O site institucional é outro projeto (`bs-logisticas`) e não deve ser tocado

## Dependências

`npm audit`: **0 vulnerabilidades**.

## Pendências abertas

Nenhuma bloqueia produção. Todas estão documentadas.

**Proteção contra senha vazada desligada** — o Supabase pode checar senhas
contra a base do HaveIBeenPwned. É o único achado do advisor de segurança.
Ativa-se no painel, em Authentication → Policies.

**Escrita permissiva em `operation_team`** — única tabela de cadastro cuja
escrita usa `is_staff()` em vez de `has_role(admin)`. Pode ser intencional, mas
a tabela não guarda autor nem histórico, então remanejamento de equipe não deixa
rastro. Ver [dívida técnica](divida-tecnica/escrita-em-operation-team.md).

**Falso sucesso em escrita bloqueada** — um `UPDATE` barrado pela RLS não
levanta erro, e a interface mostra "Registro salvo." sem ter salvo. Não é falha
de proteção — os dados ficam íntegros —, mas engana o usuário. Ver
[dívida técnica](divida-tecnica/falso-sucesso-em-update-bloqueado-por-rls.md).

**Vínculo de fatura gravável por não-admin** — a policy de
`timesheet_entries` exige apenas `is_staff()`, e a coluna `invoice_id` está
coberta por ela. Um usuário `operacional` pode desfazer o lastro de uma fatura
fechada escrevendo direto pela API. Precisa ser fechado antes de existir a
primeira conta `operacional`. Ver
[dívida técnica](divida-tecnica/rls-vinculo-de-fatura-permissivo.md).

**Sem FK de `profiles` e `user_roles` para `auth.users`** — remover usuário pelo
painel não limpa essas tabelas e deixa registros órfãos. Ao remover uma conta,
apagar primeiro as linhas dessas duas tabelas.


## Pendências de segurança rastreadas

Itens da auditoria de 05/09/2026 que ficaram pendentes, parciais, adiados ou
aceitos como risco. Cada um tem uma condição objetiva de fechamento — o item só
sai desta lista quando ela for cumprida.

Itens **já encerrados** e que não pertencem mais a esta lista: **SEC-001**
(reavaliado como falso positivo segundo a regra de negócio atual — só existem
contas admin, e usuário sem papel ou anônimo não lê nem escreve nada),
**SEC-002** (corrigido e mergeado) e o **hardening do Sentry** (concluído).

### SEC-003 — Cabeçalhos de segurança HTTP

**Status:** CORRIGIDO — validado em 06/09/2026
**Severidade original:** média

Os quatro cabeçalhos independentes de domínio estão implementados em
`next.config.ts`, aplicados a todas as rotas via `headers()`:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`

**Validação:** executada por requisição HTTP contra o **build local de produção**
do Next.js (`npm run build` seguido de `npm start`, em `localhost:3000`). Os
quatro cabeçalhos foram confirmados nas três rotas testadas:

| Rota | Status | Cabeçalhos |
| ---- | ------ | ---------- |
| `/login` | 200 | os quatro presentes |
| `/dashboard` | 307 → `/login` | os quatro presentes |
| `/` | 200 | os quatro presentes |

O `307` em `/dashboard` é o comportamento esperado para requisição não
autenticada, e confirma que os cabeçalhos acompanham também as respostas de
redirecionamento.

A validação foi feita contra a aplicação local, e não contra a Preview da
Vercel, porque a Deployment Protection intercepta as requisições no gateway SSO
antes de chegarem ao Next — nesse caminho os cabeçalhos observados são os da
plataforma, não os da aplicação.

Ponto a observar quando houver ambiente publicado sem SSO:
`X-Frame-Options: DENY` impede que a aplicação seja embutida em iframe. Se a
funcionalidade de comentários de preview da Vercel depender disso, avaliar
`SAMEORIGIN` ou uma CSP com `frame-ancestors`.

HSTS e CSP **não** fazem parte deste fechamento e seguem pendentes nos dois itens
a seguir.

### SEC-003a — HSTS

**Status:** PENDENTE POR DOMÍNIO
**Severidade:** baixa no ambiente atual
**Motivo:** o domínio definitivo ainda não foi adicionado à Vercel. Hoje a
aplicação roda apenas em `*.vercel.app`, onde a própria Vercel já envia HSTS.

**Risco atual:** baixo — todo o tráfego atual já é HTTPS pelo domínio da Vercel.
**Mitigação atual:** o domínio da plataforma já entrega HSTS.
**Condição para fechamento:** `bslogistica.com.br` e `admin.bslogistica.com.br`
definidos, apontados e funcionando em HTTPS. Só então aplicar
`Strict-Transport-Security`.

Regras que valem quando chegar a hora: **não** usar `includeSubDomains` antes de
mapear todos os subdomínios, e **não** usar `preload` sem decisão explícita — a
entrada na lista dos navegadores é rápida e a saída leva meses.

### SEC-003b — Content-Security-Policy

**Status:** PENDENTE — etapa própria
**Severidade:** média
**Motivo:** o Next injeta scripts inline e o Sentry adiciona os seus. Uma CSP mal
calibrada quebra a aplicação em silêncio, então ela não entra junto com os
cabeçalhos simples.

**Risco atual:** médio. Sem CSP, um XSS futuro teria alcance máximo. Não há XSS
conhecido: todo dado do banco é renderizado como texto em JSX, e não existe
`dangerouslySetInnerHTML` em código alcançável.
**Mitigação atual:** escaping do React e ausência de HTML dinâmico.
**Condição para fechamento:** CSP ativa em produção sem regressão, cobrindo
Next.js, Sentry (incluindo o túnel `/monitoring`), Supabase e scripts inline, com
`nonce` ou `hash`, validada primeiro em `report-only`.

### SEC-004 — Proteção contra senhas vazadas

**Status:** BLOQUEADO PELO PLANO — risco aceito
**Severidade:** média
**Motivo:** a verificação contra o HaveIBeenPwned exige plano **Pro**. O projeto
está no **Free**. A documentação oficial é explícita: *"Leaked password
protection is available on the Pro Plan and above."*

**Risco atual:** duas contas admin com acesso total, autenticação por e-mail e
senha, **sem MFA**. O vetor realista é credential stuffing — uma senha
reutilizada e já vazada acerta na primeira tentativa, e o rate limit do Supabase
não protege nesse caso.
**Mitigação atual:** signup público desativado (`disable_signup = true`);
confirmação de e-mail exigida; apenas o provider `email` habilitado.

Mitigações recomendadas, **sem custo e disponíveis hoje**: senhas longas e
exclusivas geradas por gerenciador nas duas contas admin, e MFA por TOTP, que o
plano Free suporta e que hoje tem zero fatores cadastrados.

**Condição para fechamento:** upgrade para Pro com a proteção ativada, **ou**
adoção de MFA administrativo como controle equivalente, registrado aqui como
decisão. O upgrade não é obrigatório.

### SEC-010 — Bootstrap automático do primeiro admin

**Status:** ADIADO
**Severidade:** baixa
**Motivo:** `public.provision_bslog_user`, chamada pelo trigger
`handle_bslog_auth_user_created` a cada usuário criado, concede `admin` ao novo
usuário **se não existir nenhum admin**:

```sql
IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'admin') ...
END IF;
```

**Risco atual:** baixo, mas latente. Se `user_roles` ficar sem nenhuma linha
`admin` — remoção acidental, limpeza de ambiente, restauração parcial de backup
—, o próximo usuário criado vira administrador automaticamente. Nada alerta
quando essa condição é atingida.
**Mitigação atual:** existem 2 admins, o que mantém a condição falsa; o signup
está fechado, então só quem acessa o painel do Supabase cria conta; e um
`pg_advisory_xact_lock` impede que dois cadastros simultâneos se auto-promovam.
**Condição para fechamento:** restringir o bootstrap por outro critério — variável
de ambiente, allowlist de e-mail, ou remoção da função após o provisionamento
inicial. Obrigatório reavaliar antes de reabrir o signup.

### SEC-011 — `EXECUTE` excessivo em funções auxiliares

**Status:** PENDENTE — informativo
**Severidade:** informativa
**Motivo:** `public.is_staff()` e `public.update_updated_at_column()` têm
`EXECUTE` concedido a `anon` e a `PUBLIC`, ficando expostas em `/rest/v1/rpc/`.

**Risco atual:** nenhum bypass. `is_staff()` devolve `false` para anônimo — não
vaza dado; `update_updated_at_column()` é função de trigger e falha fora desse
contexto. É superfície desnecessária, não falha de autorização. Contrasta com o
cuidado já aplicado a `gerar_fatura`, `provision_bslog_user` e `rls_auto_enable`,
todas com `REVOKE`.
**Mitigação atual:** a RLS não depende desse grant para proteger dados.
**Condição para fechamento:** `REVOKE EXECUTE ... FROM PUBLIC, anon` nas duas,
preservando `authenticated` em `is_staff()` — as policies dependem dela.

### Line endings mistos na working tree

**Status:** CORRIGIDO — normalizado em 06/09/2026
**Severidade:** nenhuma em segurança; bloqueava a validação

**Causa real.** Os blobs versionados já estavam 100% em LF: a verificação byte a
byte do HEAD mostrou zero CRLF nos 122 arquivos de texto, e a única ocorrência
de `0d0a` no repositório é dado binário dentro de `public/favicon.ico`.

O CRLF existia apenas no disco, e a cadeia era esta:

- `core.autocrlf = true`, definido pelo Git for Windows em escopo **system**
  (`C:/Program Files/Git/etc/gitconfig`), gravava CRLF na working tree a cada
  checkout;
- não havia `.gitattributes` no repositório para sobrepor essa configuração;
- o Prettier, cujo `endOfLine` padrão é `lf`, acusava cada `CR` como erro.

O resultado eram 63 arquivos em CRLF e 59 em LF no disco, com `npm run lint`
falhando com 4955 erros `prettier/prettier` — nenhum deles problema real de
código.

**Solução aplicada.** `.gitattributes` com `* text=auto eol=lf`. O `eol=lf`
sobrepõe o `core.autocrlf` e garante LF no disco em qualquer clone, sem depender
da configuração pessoal de cada máquina; o `text=auto` deixa a detecção de
binário com o git, a mesma que já classificava `public/favicon.ico` como `-text`
sem regra explícita.

`git add --renormalize .` alterou **zero blobs**, como esperado de um
repositório que já estava em LF. A working tree foi regravada a partir do
índice, e os 123 arquivos permaneceram idênticos ao HEAD hash a hash — o binário
inclusive. Nenhuma mudança funcional: `prettier --write` e `eslint --fix` não
foram usados.

**Resultado.** `w/crlf` passou de 63 para 0. `npm run lint` saiu de 4955 erros
para 0, restando apenas o warning preexistente de `react-hooks/exhaustive-deps`
em `src/app/(painel)/apontamentos/painel-apontamentos.tsx:107`. `tsc`, `build`,
`npm audit` e `git diff --check` seguem limpos.

Foi descartada a alternativa de configurar `endOfLine: "auto"` no Prettier: ela
tolera o estado misto em vez de corrigi-lo, e mascararia o problema no lint em
vez de resolvê-lo no repositório.
