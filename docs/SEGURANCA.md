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

## Segundo fator (MFA)

**Estado:** PENDENTE DE VALIDAÇÃO MANUAL.

Implementado em 06/09/2026. O primeiro teste manual, na Preview do PR #8,
**falhou**: o QR aparecia quebrado e a chave manual era recusada pelo aplicativo
autenticador. A correção está aplicada, mas **uma nova validação manual continua
necessária** — ver "Primeiro teste manual" mais abaixo.

Antes desta data não havia MFA nenhum: a busca por `mfa`, `totp`, `aal`,
`enroll`, `challenge` e `factor` em `src/` não devolvia uma única ocorrência
real. Entrar no painel exigia apenas e-mail e senha.

**O que existe agora.** TOTP pelo MFA oficial do Supabase — nenhum segredo é
gerado, guardado ou conferido pela aplicação, e não existe tabela própria de
OTP. `enroll` devolve o QR e o segredo já criados pelo Supabase;
`challengeAndVerify` confere o código no servidor dele.

**Onde a exigência é aplicada.** Em `src/app/(painel)/_autorizacao.ts`, no
servidor, dentro da mesma função que já decidia sessão e papel:

```ts
const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
if (nivel.nextLevel !== "aal2")    return { situacao: "mfa-ausente", ... };
if (nivel.currentLevel !== "aal2") return { situacao: "mfa-pendente", ... };
```

Essa função é confiável como verificação de servidor, e não como enfeite de
interface: por dentro ela chama `getUser(jwt)`, que valida o token contra o
Supabase, e calcula `nextLevel` a partir de `user.factors` filtrados por
`status === 'verified'` — dado que vem do servidor, não do cookie.
`currentLevel` sai da claim `aal` do mesmo token já validado.

O layout de `(painel)` é Server Component: sem AAL2 ele redireciona antes de
qualquer HTML ser enviado. Não há caminho de "esconder no cliente" a ser burlado
desativando JavaScript.

**Sem trancar ninguém para fora.** A tela `/mfa` fica fora do grupo `(painel)`,
justamente para não ser barrada pela guarda que a invoca. Ela exige sessão e
papel, mas não exige AAL2 — é o que se vem obter ali. Quem não tem fator cadastra
o primeiro; quem já tem responde ao desafio. O botão Sair continua disponível nas
duas situações.

**Fatores hoje:** zero. Ambas as contas admin (`bsoperacao@gmail.com` e
`bcviniciuslc@gmail.com`) estão sem fator verificado e serão levadas à tela de
cadastro no próximo acesso ao painel.

**Ressalva honesta.** O fluxo foi verificado por tipos, lint e build, e a API foi
conferida na versão instalada (`@supabase/auth-js`, via supabase-js 2.115.0) em
vez de presumida. Mas **não foi exercitado com uma conta real**: exercitá-lo
exige autenticar como admin, o que esta etapa não podia fazer. Falta também
confirmar no painel do Supabase que **TOTP enrollment está habilitado** no
projeto — a API pública de settings não expõe esse campo, e o CLI não tem
subcomando de leitura da config remota.

### Primeiro teste manual — reprovado, corrigido

**Sintomas.** QR quebrado na tela `/mfa`; chave manual recusada como inválida
pelo autenticador.

**Causa do QR.** O campo `totp.qr_code` do Supabase já vem como data URL
completo — a referência oficial usa `src={data.totp.qr_code}` direto. O
comentário do tipo em `@supabase/auth-js` afirma o contrário, que é preciso
prefixar `data:image/svg+xml;utf-8,`. A implementação seguiu o comentário do
tipo, o prefixo entrou duas vezes, e o `src` virou texto percent-encoded em vez
de SVG. Confirmado por teste em navegador: o formato de data URL usado não é
inválido em si — ele carrega normalmente quando aplicado uma vez só.

**Causa da chave.** O valor em si nunca esteve errado. Conferido direto no banco,
sem ler o segredo: 32 caracteres, apenas o alfabeto Base32 (`[A-Z2-7]`), sem
espaço, sem quebra de linha e sem caractere invisível. O problema era de entrega
— a chave era exibida num `<input>` estreito, de onde é fácil copiar só o
trecho visível, e chave truncada é recusada como inválida.

**Correção.** O `src` do QR passa a respeitar o valor recebido: usa como está
quando já é data URL, e só monta o data URL quando vier SVG cru — funciona nos
dois formatos, sem depender de qual das duas fontes está correta hoje. A chave
manual saiu do `<input>` e virou bloco monoespaçado com quebra, seleção total e
botão de copiar. A tela passa a avisar que recarregar gera chave nova.

O `alt` do QR é neutro de propósito: a referência do Supabase sugere usar
`totp.uri` ali, mas essa URI carrega o segredo TOTP e ele ficaria legível no
DOM. Nenhum log, toast ou atributo registra segredo, QR ou URI.

**Fatores não verificados.** As duas tentativas deixaram um fator `unverified`
em cada conta admin. Não foram removidos por fora: o próprio fluxo de cadastro
apaga os fatores TOTP não verificados da conta antes de criar o novo, usando
`unenroll` com a sessão do próprio usuário. Nenhum fator verificado é tocado, e
nenhuma outra conta é afetada.

Antes de considerar o MFA operante:

1. confirmar TOTP habilitado em Authentication → Multi-Factor Authentication;
2. entrar com uma conta admin e cadastrar o fator até o fim;
3. sair, entrar de novo e confirmar que o painel só abre depois do código;
4. repetir com a segunda conta admin.

## Auditoria final de produção — 06/09/2026

Leitura completa de banco, aplicação e infraestrutura. **Zero bloqueios.**

**Banco** — 18 verificações, nenhuma classificada como bloqueio:

| Verificação | Resultado |
| --- | --- |
| Tabelas `public` sem RLS | nenhuma |
| Tabelas com RLS mas sem policy | nenhuma |
| Policies que alcançam `anon` | nenhuma |
| Policies de escrita em `user_roles` | nenhuma |
| `SECURITY DEFINER` sem `search_path` fixo | nenhuma |
| Funções com `EXECUTE` para `PUBLIC` | nenhuma |
| Funções com `EXECUTE` para `anon` | nenhuma |
| `TRUNCATE` para `anon`/`authenticated` | 0 grants |
| Migrations local × remoto | 8 de 8 iguais, zero divergentes |

As quatro funções `SECURITY DEFINER` — `rls_auto_enable`,
`provision_bslog_user`, `handle_bslog_auth_user_created` e `gerar_fatura` — todas
com `search_path` fixo.

**Autorização** — a suíte `supabase/tests/002_autorizacao.sql` roda contra o
banco remoto em transação descartável e passa inteira. 25 controles, 25 PASS,
0 FAIL: admin lê e escreve; autenticado sem papel não lê nem escreve; `anon` não
alcança dado de negócio; `user_roles` não aceita autoelevação; `billed_amount`,
`cost_amount` e `invoice_id` ficam intactos para quem não é autorizado; e
`gerar_fatura` recusa não-admin com 42501.

**Auth** — `disable_signup: true`, único provider `email`,
`mailer_autoconfirm: false`, `saml_enabled: false`, `passkeys_enabled: false`,
`anonymous_users: false` — lidos da API do projeto, não presumidos.

**Frontend** — nenhum `eval`, nenhum `new Function`, nenhum `.innerHTML`. Existe
um `dangerouslySetInnerHTML` em `src/components/ui/chart.tsx`, componente do
shadcn **importado por zero arquivos**: não é alcançável, e o que ele injetaria
são cores de tema escritas no código, nunca dado do banco. O único `src` dinâmico
é o QR do MFA, entregue como data URI em `<img>` — onde SVG não executa script.

**Segredos** — a única variável lida em `src/` é `NODE_ENV`; as do Supabase
passam por `lerAmbienteSupabase()` e são as duas públicas. Nenhuma chave não
pública referenciada no cliente. O único `.env*` versionado é `.env.example`.

**Infra** — zero arquivos `.map` no build do cliente, então nenhum source map é
servido ao navegador. Sentry com `userInfo: false`, `httpBodies: []`,
`cookies: false`, headers e query params desligados nos três runtimes.

### Pontos de atenção que não bloqueiam

**`anon` tem grants de tabela nas 12 tabelas de `public`.** Herdados do
`GRANT ALL` das default privileges do Supabase. Não é acesso: nenhuma policy
alcança `anon`, e a RLS nega por padrão quem não tem policy — verificado em
execução, `anon` lê 0 linhas. É superfície desnecessária, não vulnerabilidade.
Fechar com `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon` é candidato a
uma etapa própria, porque muda o retorno da API de "vazio" para 42501 e merece
ser testado antes.

**`authenticated` tem `INSERT`, `UPDATE` e `DELETE` em `user_roles`.** Mesma
origem. Hoje só a RLS impede manipulação de papel — e impede: `INSERT` levanta
42501, `UPDATE` e `DELETE` afetam zero linhas, e ninguém se promove. Um
`REVOKE` seria uma segunda tranca, em defesa em profundidade. Não é urgente
porque a primeira tranca está provada em execução.

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

**Status:** CORRIGIDO — migration aplicada e grants verificados no banco em 06/09/2026
**Severidade:** informativa

**Diagnóstico.** `public.is_staff()` e `public.update_updated_at_column()` ficam
alcançáveis por `anon` e por `PUBLIC`, e portanto expostas em `/rest/v1/rpc/`.

**Evidência.** O Postgres concede `EXECUTE` a `PUBLIC` em toda função nova. A
migration `20260903175718` revogou de `anon` mas **não de `PUBLIC`**:

```sql
REVOKE ALL ON FUNCTION public.is_staff() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;
```

O privilégio continua chegando ao `anon` pela via do `PUBLIC`. Compare com
`has_role`, que na `20260903173220` foi revogada de `PUBLIC, anon` — ali o padrão
certo já tinha sido aplicado. `update_updated_at_column` foi criada na
`20260903173204` sem `REVOKE` nenhum.

**Risco.** Nenhum bypass. `is_staff()` devolve `false` para anônimo e não vaza
dado; `update_updated_at_column()` é função de trigger e falha fora desse
contexto. É superfície desnecessária, não falha de autorização.

**Correção.** `supabase/migrations/20260906050000_007_hardening_grants.sql`:
`REVOKE ALL ... FROM PUBLIC` e `FROM anon` nas duas funções, reafirmando
`GRANT EXECUTE ... TO authenticated, service_role` em `is_staff()` — as policies
de SELECT das tabelas de negócio dependem dela.

`authenticated` é preservado em `update_updated_at_column()` de propósito: os
triggers continuam funcionando de qualquer forma, porque o Postgres exige
`EXECUTE` de quem **cria** o trigger e não reavalia a cada disparo — mas essa
premissa não pôde ser testada contra o banco nesta etapa, e errar nela quebraria
todo `UPDATE` do sistema. O ganho seria nulo; o risco, não.

**Verificado em 06/09/2026:** `is_staff()` — PUBLIC não executa, `anon` não
executa, `authenticated` executa. `update_updated_at_column()` — PUBLIC não
executa, `anon` não executa. A consulta abaixo reproduz a conferência.

```sql
SELECT p.proname, coalesce(array_to_string(p.proacl, ' ~ '), '(NULO = PUBLIC EXECUTA)') AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('is_staff', 'update_updated_at_column');
```

### SEC-009 — `TRUNCATE` concedido a `anon` e `authenticated`

**Status:** HARDENING PREVENTIVO APLICADO — verificado no banco em 06/09/2026 / estado anterior não provado
**Severidade:** média se confirmado

**Diagnóstico.** As tabelas de `public` provavelmente concedem `TRUNCATE` a
`anon` e a `authenticated`.

**Evidência — indireta, e é importante dizer isso.** O achado se apoia no
bootstrap padrão do Supabase, que deixa configurado:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
```

`ALL` inclui `TRUNCATE`. Os `GRANT` explícitos da `20260903173204` concedem
apenas `SELECT, INSERT, UPDATE, DELETE`, mas **somam-se** ao default em vez de
substituí-lo. Não foi possível confirmar o estado real contra o banco nesta
etapa: a sessão não tinha credencial de acesso, e improvisar autenticação está
fora das regras do projeto.

**Risco.** `TRUNCATE` **não passa pela RLS**. Um `DELETE` de quem não é staff é
barrado pela policy; um `TRUNCATE` esvaziaria a tabela inteira sem consultar
policy nenhuma. Atenuante real: o PostgREST não expõe `TRUNCATE`, então
alcançá-lo exige conexão direta ao Postgres, que o JWT do painel não dá. O
privilégio está errado; a via de exploração pela API não existe hoje.

**Correção.** Na mesma migration: `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA
public` de `anon` e de `authenticated`, mais `ALTER DEFAULT PRIVILEGES ... REVOKE
TRUNCATE`, para que a próxima tabela criada não volte a nascer com ele.
`service_role` e `postgres` mantêm `TRUNCATE`: são os papéis de manutenção e
restauração.

**Verificado em 06/09/2026:** zero grants de `TRUNCATE` para `anon` e para
`authenticated`. O estado anterior ao `REVOKE` não foi medido e já não pode ser
— o hardening entra no registro como preventivo. A consulta abaixo reproduz a
conferência.

```sql
SELECT table_name, grantee FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE'
  AND grantee IN ('anon', 'authenticated');
```

### SEC-007 — Injeção de fórmula na exportação CSV

**Status:** CORRIGIDO — validado em 06/09/2026
**Severidade:** média

**Diagnóstico.** As duas exportações CSV do painel montavam o arquivo
concatenando valores do banco com `;`, sem escape algum e sem neutralizar
fórmula.

**Evidência.** Em `painel-faturamento.tsx` e `painel-relatorios.tsx`:

```ts
const lines = period.map((r) => [r.date, r.operationName, ...].join(";"));
const csv = [header.join(";"), ...lines].join("\n");
```

`operationName`, `shiftName`, `employeeName` e `clientName` são texto livre
digitado no painel. Dois problemas somados:

- **quebra estrutural** — um `;`, uma aspa ou uma quebra de linha dentro de um
  nome desalinha as colunas do arquivo inteiro;
- **execução de fórmula** — Excel e LibreOffice avaliam célula iniciada por `=`,
  `+`, `-`, `@`, TAB ou CR. Um colaborador cadastrado como `=SUM(1+1)` vira
  fórmula na planilha de quem abrir o relatório; a família `=HYPERLINK`,
  `=WEBSERVICE` e `=cmd|...` chega a exfiltrar dado ou disparar processo. Aspas
  não protegem: o Excel remove as aspas antes de decidir se a célula é fórmula.

**Correção.** `src/lib/csv.ts` centraliza a montagem. Toda célula sai entre
aspas com as aspas internas duplicadas (RFC 4180), o registro termina em CRLF, e
valor que comece com caractere de fórmula recebe apóstrofo inicial — marcador de
texto que a planilha consome ao exibir, recomendação da OWASP.

Número puro passa intacto de propósito: `-123` é o número -123 em qualquer
planilha, não uma fórmula, e neutralizá-lo transformaria toda coluna de custo
negativo em texto que não soma. O que é neutralizado é `-` seguido de conteúdo
não numérico, como uma chamada de comando embutida.

**Evidência da correção.** 14 casos testados diretamente, sem instalar
dependência: fórmula clássica, `+123`, `-123`, injeção real usando `-`, prefixo
`@`, TAB inicial, texto comum, vírgula, aspas, quebra de linha, `;`, acentos,
decimal brasileiro e `null`. Resultado: 4 células neutralizadas, 10 intactas,
**14 de 14 reconstruídas com o conteúdo original** ao reler o arquivo, e **zero
células** ainda iniciando por caractere de fórmula.

### SEC-006 — Mass assignment no CRUD genérico

**Status:** FALSO POSITIVO / RISCO DE DESIGN — sem correção necessária
**Severidade:** nenhuma no modelo atual

**Diagnóstico.** `useSaveRow` em `src/lib/mutations.ts` desestrutura
`{ id, ...rest }` e envia `rest` inteiro ao Supabase, sem allowlist de colunas.

**Evidência.** O padrão existe e alimenta `clients`, `contracts`, `employees`,
`operations` e `shifts`. Mas ele **não é a fronteira de segurança**: é código de
navegador. Quem quisesse acrescentar campos arbitrários não precisaria passar por
essa função — bastaria chamar o PostgREST direto com o próprio JWT. Não existe
handler de servidor que a allowlist estaria protegendo: todo caminho de escrita é
cliente → PostgREST, e o controle é a RLS.

E a RLS decide sobre a **linha**, não sobre o conjunto de colunas do payload: um
usuário não autorizado tem a operação inteira recusada, independentemente de
quais campos tenha enviado.

Verificado nas policies da `20260903175718`:

- `clients`, `contracts`, `employees`, `invoices`, `invoice_items` — escrita
  exige `has_role(auth.uid(), 'admin')` em `USING` e em `WITH CHECK`;
- `operations`, `shifts`, `operation_team`, `timesheets`, `timesheet_entries` —
  exigem `is_staff()`;
- `user_roles` — só existe policy de `SELECT` de linhas próprias, e o grant de
  tabela é apenas `SELECT`. Sem `INSERT`, `UPDATE` ou `DELETE`: **não há
  autoelevação**;
- todas as policies são `TO authenticated`; `anon` não alcança nenhuma tabela de
  negócio.

**Resposta à pergunta central** — um usuário não autorizado consegue acrescentar
campos arbitrários e modificar dados que não deveria? **Não.** Sem papel,
`is_staff()` e `has_role()` devolvem `false` e toda escrita é recusada, com ou
sem campos extras.

**Por que continua sendo risco de design.** O dia em que existir uma conta
`operacional`, `is_staff()` passa a ser verdadeiro para ela, e as tabelas
operacionais aceitam qualquer coluna que o payload trouxer — incluindo
`billed_amount`, `cost_amount` e `invoice_id` em `timesheet_entries`. Isso já está
rastreado como dívida técnica em
[`rls-vinculo-de-fatura-permissivo.md`](divida-tecnica/rls-vinculo-de-fatura-permissivo.md)
e [`escrita-em-operation-team.md`](divida-tecnica/escrita-em-operation-team.md), e
a correção certa é na RLS e nos privilégios de coluna, não numa allowlist no
navegador — que o atacante contorna ignorando o navegador.

**Condição para reabertura:** criação da primeira conta não-admin. Antes disso,
fechar as duas dívidas acima.

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
