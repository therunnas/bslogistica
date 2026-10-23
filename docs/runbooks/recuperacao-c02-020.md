# Recuperação emergencial da migration 020 (C02)

> **ESTE SCRIPT NÃO É UMA MIGRATION DE APLICAÇÃO AUTOMÁTICA.**
> **NÃO EXECUTAR SEM AUTORIZAÇÃO.**

Arquivo: [`recuperacao-c02-020.sql`](recuperacao-c02-020.sql). Cópia **byte a byte**
do script validado na homologação D4D2 (SHA-256
`ae02adec1e3d71c3afa92fce71a600a4e4ab55cfbb06d7837a31997822f04fa4`, 276 linhas).
Não está em `supabase/migrations/` **de propósito**: `supabase db push` e
`supabase db reset` aplicariam qualquer arquivo ali.

## O que é

Desfaz o efeito da migration `20261018120000_020_revogacao_de_identidade.sql`:

- restaura `has_role()`, `is_staff()` e `proteger_ultimo_admin()` aos corpos de
  `20260903175718` e `20260928120000`;
- devolve as 29 policies à expressão anterior;
- remove `conta_ativa(uuid)` e `identidade_atual_utilizavel()`.

Não toca dados de negócio, usuários, papéis, sessões, grants de tabela, RLS,
`FORCE RLS`, a migration 019 nem `supabase_migrations.schema_migrations`.

## Consequência de usar: reabre a C02

**Reverter a 020 reabre a vulnerabilidade C02.** Depois da recuperação, o JWT de uma
conta banida, excluída ou deslogada volta a ser autorizado pela RLS e pelas RPCs até
o `exp` (medido na homologação: conta banida com sessão viva passou de
`has_role(admin)=false` e 0 linhas para `true` e leitura de dados). É uma medida
**excepcional**, não uma solução: planeje a correção definitiva logo depois.

## Quando usar

Só se a 020 causar dano operacional grave **e** não houver correção direta mais
segura. Antes de cogitar o script, prefira corrigir sem rollback:

| Sintoma                                                 | Causa provável                             | Correção sem reabrir a C02                                |
| ------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Todo o RLS nega; `permission denied for table sessions` | `postgres` sem `SELECT` em `auth.sessions` | conceder o privilégio faltante (decisão e teste próprios) |
| Usuário legítimo sem acesso                             | sessão ausente em `auth.sessions`          | novo login do usuário; diagnosticar por leitura           |
| Falha só em uma policy                                  | expressão divergente                       | migration corretiva pontual                               |

Quem decide usar o script é quem responde pelo projeto, **por escrito, antes**.

## Pré-requisitos

1. **Autorização explícita** para esta execução, com data e responsável.
2. Executor `postgres` (SQL Editor do projeto Production `ehkduqokntemtmqzdrbd`).
   Confirmar o ref na URL do painel.
3. Estado atual **exatamente** o da 020. O próprio script confere isso e aborta se:
   - as helpers não existem (020 não aplicada, ou recuperação já feita);
   - os cinco corpos de função não são os da 020 (comparação por MD5);
   - alguma outra função referencia as helpers;
   - as 29 policies não estão como a 020 as deixou, ou há contagem diferente de
     50 policies / 23 `RESTRICTIVE`;
   - o trigger `trg_proteger_ultimo_admin` não existe.
4. **Fins de linha LF.** O repositório fixa `eol=lf` (`.gitattributes`). Colar o
   script com CRLF muda o `md5` dos corpos e a autoverificação aborta (falha segura,
   nada muda). Pela mesma razão: se a 020 foi aplicada por uma fonte com CRLF, o
   `md5` dos corpos no banco difere do esperado e a **pré-condição aborta**. Isso
   aconteceu uma vez no projeto (migration 005, 154 CR a mais). Nesse caso **não
   adaptar o script na hora**: comparar com `md5(replace(prosrc, E'\r', ''))` por
   leitura, e qualquer ajuste do script exige novo teste e nova autorização.

## Procedimento

1. Registrar o estado antes (leitura): contagem de policies, `md5` das três funções,
   `schema_migrations`.
2. Colar o arquivo **inteiro** e executar **uma vez**. Tudo está em
   `BEGIN … COMMIT`: pré-condições, mudanças e autoverificação. Qualquer erro desfaz
   tudo. O `lock_timeout` (10 s) evita ficar preso em bloqueio.
3. Se terminar sem erro, confirmar o COMMIT **em outra aba**:
   `select to_regprocedure('public.identidade_atual_utilizavel()');` deve ser `NULL`.
4. Se falhar: **parar**, copiar a mensagem, confirmar por leitura que nada mudou e
   escalar. Não editar o script nem repetir às cegas.

Tempo local na homologação: cerca de 0,2 s com pouco dado. Em Production depende
do tráfego (bloqueios curtos de metadado nas tabelas).

## Validação posterior (leitura)

```sql
-- helpers removidas
select to_regprocedure('public.conta_ativa(uuid)'),
       to_regprocedure('public.identidade_atual_utilizavel()');             -- NULL, NULL

-- nenhuma policy referencia as helpers
select count(*) from pg_policies
 where schemaname = 'public'
   and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(identidade_atual_utilizavel|conta_ativa)';  -- 0

-- corpos originais (md5 de prosrc)
select proname, md5(prosrc) from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('has_role', 'is_staff', 'proteger_ultimo_admin') order by 1;
-- has_role               4e852b30ef52ba5263c4e11d1aec8cf0
-- is_staff               3de3f52763de2b7c25ca64e81c69a098
-- proteger_ultimo_admin  94f7ede94e766abc6fc3a4bda2d43573

select count(*) filter (where permissive = 'RESTRICTIVE'), count(*)
  from pg_policies where schemaname = 'public';                             -- 23, 50
```

Depois, **validação funcional** (não só de catálogo): login e painel de um admin real
em AAL2, `/operacional` com um operador real, ausência de 5xx e olhar os logs de
autenticação. Não banir nem excluir usuários reais para testar.

## Histórico de migrations

O script **não** mexe em `supabase_migrations.schema_migrations`.

- **Não** marcar a 020 como `reverted` e **não** editar a tabela à mão: marcar
  `reverted` apaga a linha e deixa a 020 "pendente"; um `db push` a reaplicaria.
- Manter a 020 registrada como aplicada e registrar a recuperação como migration
  **compensatória nova**, com timestamp posterior (por exemplo
  `…_021_reverter_revogacao_de_identidade`), criada a partir deste script **somente no
  momento do uso** e com autorização. Executá-la e então
  `supabase migration repair --linked --status applied <versão>`, uma versão por vez.
- Assim o histórico fica auditável: 020 aplicada, depois a compensatória.
- Reaplicar a 020 depois (roll-forward) foi testado: o corpo da 020 roda sobre o
  estado recuperado sem erro. Isso também exige migration nova com registro próprio.

## Limites do que foi validado

Homologação local (Postgres 17, `postgres` com superusuário, sem aplicação rodando,
sem concorrência): catálogo recuperado **idêntico** ao das 24 migrations da `main`
(funções, policies, triggers, relações, ACLs, memberships), dados idênticos, falha
injetada com rollback completo, divergência barrada pelas pré-condições, segunda
execução falha seguro, e 13/13 suítes originais (704 asserções) passando. **Não
prova** privilégios do Supabase hospedado nem a recuperação funcional da aplicação.

## Restaurar um dump lógico de Production: o event trigger `ensure_rls`

Este runbook trata da reversão da `020`. A **restauração de um dump lógico** de
Production (`pg_dump -Fc` dos schemas `public`, `auth`, `storage` e
`supabase_migrations`) tem uma lacuna que se aplica a qualquer recuperação:

- Production tem **7 event triggers habilitados**. Um é do projeto, `ensure_rls`
  (`ddl_command_end`, tags `CREATE TABLE`, `CREATE TABLE AS`, `SELECT INTO`), que chama
  `public.rls_auto_enable()` e liga RLS em toda tabela nova de `public`. Os outros 6
  (`issue_graphql_placeholder`, `issue_pg_cron_access`, `issue_pg_graphql_access`,
  `issue_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`) pertencem a
  `supabase_admin`, vêm do provisionamento da plataforma e **não** se recriam à mão.
- Event trigger é objeto do banco, não de um schema: o dump filtrado por schema **não o
  preserva**. A função `public.rls_auto_enable()` é restaurada; o trigger, não.
- Depois do `pg_restore`, recriar e verificar:

```sql
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

select evtname, evtevent, evtenabled, evtfoid::regprocedure::text, evttags::text
  from pg_event_trigger where evtname = 'ensure_rls';
-- ensure_rls | ddl_command_end | O | rls_auto_enable() | {"CREATE TABLE","CREATE TABLE AS","SELECT INTO"}

select count(*) from pg_class
 where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity;  -- 0
```

- **Privilégio:** criar event trigger exige superusuário no PostgreSQL padrão. Num
  Postgres local, `supabase_admin` é superusuário, então a criação é possível por essa
  regra. Em Supabase hospedado o `postgres` **não** é superusuário e o trigger pertence
  a ele: **o privilégio necessário em Production não está comprovado.** Antes de depender
  disso, conferir se o painel (opção de habilitar RLS automaticamente) ou o suporte da
  plataforma o recria.
- Sem o trigger, as tabelas existentes continuam protegidas (a RLS vem no dump); só tabela
  **nova** criada fora de migration nasceria sem RLS. As migrations do projeto ligam RLS
  explicitamente.
- A suíte `supabase/tests/002_autorizacao.sql` depende desse trigger: ela cria uma tabela
  em `public` e exige RLS ligada. Em banco restaurado sem o trigger ela falha, e essa
  falha é **esperada**, não um defeito das migrations. Rodar a 002 só em banco local
  descartável, nunca em Production.
- Este é um backup **do PostgreSQL**. Não cobre a configuração de Auth (MFA, SMTP, Site
  URL), os segredos da Vercel, o Storage (0 objetos), os dados dos schemas `vault` e
  `realtime`, nem funções de borda.
