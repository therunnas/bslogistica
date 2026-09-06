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

**Status:** PARCIAL
**Severidade:** média
**Motivo:** os quatro cabeçalhos independentes de domínio estão implementados em
`next.config.ts`, mas ainda não foram confirmados numa resposta HTTP real.

Concluído:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`

Pendente: teste HTTP real; HSTS; CSP.

**Risco atual:** baixo. A configuração compila e o build passa; o que falta é a
verificação empírica de que o servidor os entrega.
**Mitigação atual:** nenhuma necessária — os cabeçalhos são defesa adicional, não
substituem a RLS.
**Condição para fechamento:** cabeçalhos confirmados por resposta HTTP no
ambiente publicado, nas rotas `/login`, `/dashboard` e uma rota do painel.

Ponto a observar na primeira Preview: `X-Frame-Options: DENY` impede que a
aplicação seja embutida em iframe. Se a funcionalidade de comentários de preview
da Vercel depender disso, avaliar `SAMEORIGIN` ou uma CSP com `frame-ancestors`.

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

### Line endings mistos no repositório

**Status:** PENDENTE — não é vulnerabilidade
**Severidade:** nenhuma em segurança; bloqueia a validação
**Motivo:** o repositório tem fins de linha mistos **nos próprios blobs**: 62 dos
122 arquivos de texto rastreados estão em CRLF e 60 em LF. Não há
`.gitattributes`, e `core.autocrlf` está como `true` nesta máquina.

O `eslint-plugin-prettier` marca cada `CR` como erro, então `npm run lint` falha
com milhares de erros de formatação, sem nenhum problema real de código.

**Risco atual:** nenhum para segurança. O efeito é impedir que o lint sirva de
sinal — um erro real se perderia no meio do ruído.
**Mitigação atual:** `tsc`, `build` e `npm audit` continuam limpos e cobrem o que
importa.
**Condição para fechamento:** decidir entre normalizar tudo para LF com
`.gitattributes` (`* text=auto eol=lf`), o que reescreve 62 arquivos num commit
próprio e dedicado, ou configurar `endOfLine: "auto"` no Prettier, que tolera o
estado misto sem tocar nos arquivos. A primeira é a correção de raiz; a segunda é
de uma linha.
